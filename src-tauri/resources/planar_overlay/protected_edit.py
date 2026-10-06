"""명시된 선택/보호 마스크만 사용하는 CPU 편집. 의미 분할·모델 생성 기능이 아닙니다."""
from pathlib import Path
import argparse,json,hashlib,os
import numpy as np
from PIL import Image,ImageDraw

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def rasterize_matte(size,foreground_polygons,holes=()):
    """원본 좌표의 다각형과 내부 배경 구멍을 그대로 래스터화합니다. 자동 추론은 없습니다."""
    width,height=size;mask=Image.new('L',size);draw=ImageDraw.Draw(mask)
    for polygons,value in [(foreground_polygons,255),(holes,0)]:
        for polygon in polygons:
            if len(polygon)<3 or any(len(p)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and np.isfinite(v) for v in p) or not (0<=p[0]<width and 0<=p[1]<height) for p in polygon):raise ValueError('invalid_native_polygon')
            draw.polygon([tuple(p)for p in polygon],fill=value)
    return mask

def map_selection(mask,size,coordinates):
    """RGB는 리사이즈하지 않습니다. crop 픽셀 중심을 원본 좌표에 nearest로 대응합니다."""
    if mask.mode!='L':raise ValueError('selection_requires_grayscale_L')
    width,height=size
    if coordinates.get('space')=='native':
        if mask.size!=size:raise ValueError('native_mask_size_mismatch')
        return np.asarray(mask).copy(),{'space':'native','maskSize':list(mask.size),'sourceSize':list(size),'resampling':'none'}
    if coordinates.get('space')!='crop':raise ValueError('mask_coordinate_space_required')
    x,y,w,h=[coordinates.get(k)for k in ['x','y','width','height']]
    if any(isinstance(v,bool) or not isinstance(v,int) or v<0 for v in [x,y,w,h]) or w<1 or h<1 or x+w>width or y+h>height:raise ValueError('crop_mapping_out_of_bounds')
    result=np.zeros((height,width),np.uint8)
    ys=np.minimum(((np.arange(h)+.5)*mask.height/h).astype(int),mask.height-1)
    xs=np.minimum(((np.arange(w)+.5)*mask.width/w).astype(int),mask.width-1)
    result[y:y+h,x:x+w]=np.asarray(mask)[ys[:,None],xs[None,:]]
    return result,{'space':'crop','crop':[x,y,w,h],'maskSize':list(mask.size),'sourceSize':list(size),'pixelCenterMapping':'floor((sourceOffset + 0.5) * maskExtent / cropExtent)','resampling':'nearest_mask_only'}

def blend_protected(source,replacement,selection,protection):
    src=np.asarray(source.convert('RGB'));other=np.asarray(replacement.convert('RGB'))
    if src.shape!=other.shape or selection.shape!=src.shape[:2] or protection.shape!=src.shape[:2]:raise ValueError('native_size_mismatch')
    alpha=selection.astype(float)/255*(protection==0)
    if replacement.mode=='RGBA':alpha*=np.asarray(replacement.getchannel('A')).astype(float)/255
    result=np.rint(src*(1-alpha[:,:,None])+other*alpha[:,:,None]).clip(0,255).astype(np.uint8)
    assert np.array_equal(result[alpha==0],src[alpha==0])
    return result,alpha

def repair_glyph_surface(source,selection,protection):
    """선택 글자의 주변 종이/그림자 기울기를 적합합니다. 격자·손·펜은 donor에서도 제외합니다."""
    import cv2
    cv2.setNumThreads(1)
    rgb=np.asarray(source.convert('RGB'));result=rgb.copy();count,labels,stats,_=cv2.connectedComponentsWithStats((selection>0).astype(np.uint8),8)
    # 보호 윤곽의 안티앨리어싱이 채움 참조에 섞이지 않도록 donor에서만 3px 더 제외합니다.
    # 실제 편집 alpha나 보호 마스크를 확장/축소하지 않습니다.
    donor_protection=cv2.dilate((protection>0).astype(np.uint8),np.ones((7,7),np.uint8))
    for label in range(1,count):
        x,y,w,h,area=map(int,stats[label])
        if area>4096:raise ValueError('glyph_selection_too_broad: 좁은 글자 선택이 필요합니다')
        left,top=max(0,x-12),max(0,y-12);right,bottom=min(rgb.shape[1],x+w+12),min(rgb.shape[0],y+h+12)
        yy,xx=np.mgrid[top:bottom,left:right];donor=(selection[top:bottom,left:right]==0)&(donor_protection[top:bottom,left:right]==0)
        if donor.sum()<12:raise ValueError('insufficient_unprotected_paper_donors')
        rows=np.stack([np.ones_like(xx),(xx-x)/max(w,12),(yy-y)/max(h,12)],axis=2).astype(float)
        matrix=rows[donor];colors=rgb[top:bottom,left:right][donor].astype(float);keep=np.ones(len(matrix),bool)
        for _ in range(4):
            if keep.sum()<12:raise ValueError('insufficient_robust_paper_donors')
            fit=np.linalg.lstsq(matrix[keep],colors[keep],rcond=None)[0]
            residual=np.abs(matrix@fit-colors).max(axis=1);keep=residual<=max(3,float(np.median(residual))*3)
        target=labels[top:bottom,left:right]==label
        fitted=np.rint(rows@fit).clip(0,255).astype(np.uint8)
        result[top:bottom,left:right][target]=fitted[target]
    return Image.fromarray(result)

def run(request,output):
    mode=request.get('mode');width,height=request.get('width'),request.get('height')
    if mode not in ['compose','erase-text'] or any(isinstance(v,bool) or not isinstance(v,int) or not 16<=v<=8192 for v in [width,height]) or width*height>20_000_000:raise ValueError('invalid_request')
    paths={};images={}
    for key in ['sourceImage','selectionMask','protectionMask']+(['replacementImage']if request.get('replacementImage')else[]):
        p=Path(request[key]);expected=request.get({'sourceImage':'sourceSha256','selectionMask':'selectionSha256','protectionMask':'protectionSha256','replacementImage':'replacementSha256'}[key])
        if not p.is_file() or '://' in str(p):raise ValueError('local_asset_required:'+key)
        if digest(p)!=expected:raise ValueError('input_hash_mismatch:'+key)
        paths[key]=(p,expected);im=Image.open(p)
        if getattr(im,'n_frames',1)!=1:raise ValueError('static_image_required:'+key)
        im.load();images[key]=im
    source=images['sourceImage'];protect=images['protectionMask']
    if source.size!=(width,height) or protect.size!=source.size or protect.mode!='L':raise ValueError('native_size_or_protection_mismatch')
    selection,mapping=map_selection(images['selectionMask'],source.size,request['maskCoordinates']);protected=np.asarray(protect)
    admitted=selection.copy();admitted[protected>0]=0
    if not admitted.any():raise ValueError('empty_effective_selection')
    literal=request.get('requiredText')
    if literal is not None and literal not in ['내 시간','한국사']:raise ValueError('unsupported_exact_text_declaration')
    if literal is not None and 'replacementImage'not in images:raise ValueError('exact_text_rgba_layer_required')
    if mode=='compose':
        if 'replacementImage'not in images or literal is not None:raise ValueError('compose_replacement_required_no_text_declaration')
        replacement=images['replacementImage']
        if replacement.size!=source.size:raise ValueError('replacement_size_mismatch')
    else:
        if any(v not in [0,255]for v in np.unique(selection)):raise ValueError('erase_text_requires_binary_selection')
        replacement=repair_glyph_surface(source,admitted,protected)
    result,alpha=blend_protected(source,replacement,admitted,protected)
    text_pixels=0
    if mode=='erase-text' and 'replacementImage'in images:
        layer=images['replacementImage']
        if literal is None or layer.mode!='RGBA' or layer.size!=source.size:raise ValueError('declared_exact_text_native_rgba_required')
        raw_text_alpha=np.asarray(layer.getchannel('A'))
        if ((raw_text_alpha>0)&(protected>0)).any():raise ValueError('exact_text_intersects_protection: 글자를 자르지 말고 레이어 위치를 조정하세요')
        text_alpha=raw_text_alpha.astype(float)/255
        text_pixels=int((text_alpha>0).sum());rgb=np.asarray(layer.convert('RGB'))
        result=np.rint(result*(1-text_alpha[:,:,None])+rgb*text_alpha[:,:,None]).clip(0,255).astype(np.uint8)
        alpha=np.maximum(alpha,text_alpha)
    src=np.asarray(source.convert('RGB'))
    if not np.array_equal(result[alpha==0],src[alpha==0]) or not np.array_equal(result[protected>0],src[protected>0]):raise RuntimeError('protected_pixels_changed')
    directory=Path(output);directory.mkdir(parents=True,exist_ok=False)
    made=directory/'protected-edit.png';Image.fromarray(result).save(made)
    Image.fromarray(np.rint(alpha*255).astype(np.uint8)).save(directory/'effective-alpha.png');Image.fromarray(selection).save(directory/'mapped-selection.png');protect.save(directory/'protection.png')
    difference=np.abs(result.astype(int)-src.astype(int)).max(axis=2);Image.fromarray(np.minimum(difference*8,255).astype(np.uint8)).save(directory/'difference-x8.png')
    for p,expected in paths.values():
        if digest(p)!=expected:raise RuntimeError('input_changed_during_edit')
    report={'status':'generated','image':str(made),'imageSha256':digest(made),'width':width,'height':height,'maskMapping':mapping,'selectedPixels':int((selection>0).sum()),'blockedSelectionPixels':int(((selection>0)&(protected>0)).sum()),'effectivePixels':int((alpha>0).sum()),'textLayerPixels':text_pixels,'allLosslessOutsideZeroAlphaPixelsExact':True,'protectedPixelsExact':True,'originalUnchanged':True,'gpuUsed':False,'automaticSemanticSelection':False,'newModelUsed':False,'requiredTextDeclaration':literal,'requiredTextGlyphsVerified':False,'qualityApproved':False,'primaryChanged':False,'attached':False,'actualPythonPid':os.getpid()}
    (directory/'result.json').write_text(json.dumps(report,indent=2),encoding='utf8');return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--output-directory',required=True);p.add_argument('--ffmpeg');a=p.parse_args();request=json.loads(Path(a.request).read_text(encoding='utf8'));print(json.dumps(run(request,a.output_directory)))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'status':'error','error':str(e),'originalMutationPerformed':False,'qualityApproved':False}));raise SystemExit(1)
