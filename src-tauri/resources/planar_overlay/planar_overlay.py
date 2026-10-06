"""좌표와 원본을 고정한 CPU 평면 합성. 설치·GPU·자동 추적·프로젝트 쓰기는 하지 않습니다."""
from pathlib import Path
from fractions import Fraction
import argparse,json,hashlib,subprocess,os
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
import av

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def quad_checked(quad,width,height):
    if not isinstance(quad,list) or len(quad)!=4 or any(not isinstance(p,list) or len(p)!=2 for p in quad):raise ValueError('invalid_quad: TL/TR/BR/BL 네 점이 필요합니다')
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) for p in quad for x in p):raise ValueError('invalid_quad: 숫자 좌표가 필요합니다')
    q=np.asarray(quad,dtype=float)
    if not np.isfinite(q).all() or (q<0).any() or (q[:,0]>width-1).any() or (q[:,1]>height-1).any():raise ValueError('invalid_quad: 화면 밖 또는 유한하지 않은 좌표')
    crosses=[]
    for i in range(4):
        a=q[(i+1)%4]-q[i];b=q[(i+2)%4]-q[(i+1)%4];crosses.append(a[0]*b[1]-a[1]*b[0])
    area=0.5*sum(q[i,0]*q[(i+1)%4,1]-q[(i+1)%4,0]*q[i,1] for i in range(4))
    if min(crosses)<=0 or area<64 or area>width*height*0.95:raise ValueError('invalid_quad: 순서·교차·퇴화·면적을 확인하세요')
    return q

def warp_coefficients(quad,raster_size):
    # Pillow는 출력→입력 사상을 받습니다. 임의 좌표를 재추적하지 않고 명시된 평면만 풉니다.
    w,h=raster_size;target=[(0,0),(w-1,0),(w-1,h-1),(0,h-1)];rows=[];values=[]
    for (x,y),(u,v) in zip(quad,target):
        rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);values.extend([u,v])
    matrix=np.asarray(rows,dtype=float)
    if np.linalg.cond(matrix)>1e12:raise ValueError('invalid_quad: 불안정한 투영')
    return tuple(np.linalg.solve(matrix,np.asarray(values)))

def composite_frame(original,replacement,quad,inset=4):
    width,height=original.size;q=quad_checked(quad,width,height)
    safe=Image.new('L',(width,height),0);ImageDraw.Draw(safe).polygon([tuple(p) for p in q],fill=255)
    safe=safe.filter(ImageFilter.MinFilter(2*inset+1))
    safe_array=np.asarray(safe)
    if not (safe_array>0).any():raise ValueError('invalid_mask: 내부 보호 영역이 없습니다')
    warped=replacement.transform((width,height),Image.Transform.PERSPECTIVE,warp_coefficients(q,replacement.size),Image.Resampling.BICUBIC)
    # blur는 안쪽에서만 적용합니다. 경계를 부드럽게 해도 보호 영역 밖으로 alpha가 번지지 않습니다.
    feather=np.asarray(safe.filter(ImageFilter.GaussianBlur(.75))).astype(float)/255
    alpha=np.asarray(warped.getchannel('A')).astype(float)/255*feather*(safe_array>0)
    base=np.asarray(original.convert('RGB'));rgb=np.asarray(warped.convert('RGB'))
    result=np.rint(base.astype(float)*(1-alpha[:,:,None])+rgb.astype(float)*alpha[:,:,None]).clip(0,255).astype(np.uint8)
    if not np.array_equal(result[alpha==0],base[alpha==0]):raise RuntimeError('outside_mask_changed')
    return Image.fromarray(result),safe,alpha

def validate_input(request):
    for key in ['sourceVideo','replacementImage','sourceSha256','replacementSha256','width','height','fps','frames','coordinates']:
        if key not in request:raise ValueError('invalid_request: '+key)
    source=Path(request['sourceVideo']);replacement=Path(request['replacementImage'])
    if not source.is_file() or not replacement.is_file() or '://' in str(source) or '://' in str(replacement):raise ValueError('invalid_asset: 로컬 파일이 필요합니다')
    if digest(source)!=request['sourceSha256'] or digest(replacement)!=request['replacementSha256']:raise ValueError('source_hash_mismatch')
    width,height,count=request['width'],request['height'],request['frames']
    if any(isinstance(x,bool) or not isinstance(x,int) or x<1 for x in [width,height,count]) or width>8192 or height>8192 or count>6000:raise ValueError('invalid_request: 크기·프레임 범위')
    if width%2 or height%2 or width*height*count>150_000_000:raise ValueError('unsupported_budget: 짝수 크기와 총 1.5억 픽셀 이내의 CPU 작업을 지정하세요')
    mode=request.get('contentMode')
    if mode not in ['non-text','exact-text'] or mode=='non-text' and request.get('requiredText') is not None or mode=='exact-text' and request.get('requiredText')!='한국사':raise ValueError('invalid_content: 비문자 화면 또는 한국사 표지 raster를 명시하세요')
    if request.get('target',{}).get('id')=='guho-cut-03-02' and mode!='exact-text':raise ValueError('invalid_content: 한국사 표지가 필요합니다')
    fps=Fraction(str(request['fps']))
    if not 0<fps<=60:raise ValueError('invalid_request: fps')
    if not isinstance(request['coordinates'],list) or len(request['coordinates'])!=count:raise ValueError('missing_quad: 모든 프레임의 좌표가 필요합니다')
    for i,item in enumerate(request['coordinates']):
        if item.get('frame')!=i or isinstance(item.get('frame'),bool):raise ValueError('frame_index_mismatch')
        if 'timeSeconds' in item and abs(Fraction(str(item['timeSeconds']))-Fraction(i,1)/fps)>Fraction(1,1000000):raise ValueError('coordinate_time_mismatch')
        quad_checked(item['quad'],width,height)
    raster=Image.open(replacement);raster.load()
    if raster.mode!='RGBA' or min(raster.size)<2 or max(raster.size)>8192:raise ValueError('invalid_replacement: RGBA 화면 raster가 필요합니다')
    with av.open(str(source)) as container:
        video=container.streams.video
        if len(video)!=1:raise ValueError('unsupported_video: 영상 트랙 하나가 필요합니다')
        stream=video[0]
        if stream.width!=width or stream.height!=height or stream.average_rate!=fps:raise ValueError('video_spec_mismatch')
        seen=0
        for frame in container.decode(video=0):
            if frame.pts is None or frame.time_base is None or Fraction(frame.pts)*frame.time_base!=Fraction(seen,1)/fps:raise ValueError('source_pts_mismatch: CFR 원본을 재시간화하지 않습니다')
            seen+=1
        if seen!=count:raise ValueError('source_frame_count_mismatch')
        duration=Fraction(count,1)/fps
        if stream.duration is not None and abs(Fraction(stream.duration)*stream.time_base-duration)>Fraction(1,1000000):raise ValueError('source_duration_mismatch')
    return source,replacement,raster,fps

def run(request,output,ffmpeg):
    source,replacement,raster,fps=validate_input(request)
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    frames_dir=output/'lossless-frames';masks_dir=output/'safe-masks';frames_dir.mkdir();masks_dir.mkdir()
    frame_reports=[]
    with av.open(str(source)) as container:
        audio_tracks=len(container.streams.audio)
        for index,frame in enumerate(container.decode(video=0)):
            original=frame.to_image().convert('RGB');quad=request['coordinates'][index]['quad']
            made,safe,alpha=composite_frame(original,raster,quad)
            name=f'frame-{index:06}.png';made.save(frames_dir/name);safe.save(masks_dir/name)
            frame_reports.append({'frame':index,'pts':frame.pts,'timeBase':str(frame.time_base),'outsideZeroAlphaPixelsExact':True,'zeroAlphaPixels':int((alpha==0).sum()),'safeMaskPixels':int((np.asarray(safe)>0).sum()),'outputPngSha256':digest(frames_dir/name)})
    if digest(source)!=request['sourceSha256'] or digest(replacement)!=request['replacementSha256']:raise RuntimeError('source_changed_during_render')
    video=output/'planar-overlay.mp4'
    command=[str(ffmpeg),'-nostdin','-hide_banner','-loglevel','error','-n','-threads','2','-framerate',str(fps),'-i',str(frames_dir/'frame-%06d.png'),'-i',str(source),'-map','0:v:0','-map','1:a?','-c:v','libx264','-threads','2','-crf','18','-pix_fmt','yuv420p','-bf','0','-c:a','copy','-map_metadata','1','-movflags','+faststart',str(video)]
    subprocess.run(command,check=True,capture_output=True)
    with av.open(str(video)) as container:
        stream=container.streams.video[0];seen=0
        for frame in container.decode(video=0):
            if Fraction(frame.pts)*frame.time_base!=Fraction(seen,1)/fps:raise RuntimeError('output_pts_mismatch')
            seen+=1
        if seen!=request['frames'] or stream.average_rate!=fps or stream.duration is None or abs(Fraction(stream.duration)*stream.time_base-Fraction(seen,1)/fps)>Fraction(1,1000000):raise RuntimeError('output_timing_mismatch')
        if len(container.streams.audio)!=audio_tracks:raise RuntimeError('output_audio_tracks_mismatch')
    if digest(source)!=request['sourceSha256'] or digest(replacement)!=request['replacementSha256']:raise RuntimeError('original_changed')
    report={'status':'generated','video':str(video),'sourceSha256':request['sourceSha256'],'replacementSha256':request['replacementSha256'],'videoSha256':digest(video),'width':request['width'],'height':request['height'],'fps':str(fps),'frames':seen,'durationSeconds':float(Fraction(seen,1)/fps),'frameReports':frame_reports,'allLosslessOutsideZeroAlphaPixelsExact':True,'safeMaskInsetPixels':4,'audioTracks':audio_tracks,'audioStreamCopyRequested':True,'fabricatedAudio':False,'gpuUsed':False,'automaticTracking':False,'originalUnchanged':True,'lossyOutsideMaskBitExactClaim':False,'requiredTextDeclaration':request.get('requiredText'),'requiredTextGlyphsVerified':False,'framesActuallyViewed':[],'continuousPlaybackVerified':False,'actualHearing':False,'qualityApproved':False,'primaryChanged':False,'actualPythonPid':os.getpid()}
    (output/'result.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--output-directory',required=True);parser.add_argument('--ffmpeg',required=True)
    args=parser.parse_args();request=json.loads(Path(args.request).read_text(encoding='utf8'))
    print(json.dumps(run(request,args.output_directory,args.ffmpeg)))
if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'error','error':str(error),'qualityApproved':False,'originalMutationPerformed':False}));raise SystemExit(1)
