"""원본 프레임의 구간·연결·명시적 홀드만 처리하는 CPU 작업자입니다."""
from pathlib import Path
from fractions import Fraction
import argparse, hashlib, json, subprocess
import av

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def rgb_hash(frame):return hashlib.sha256(frame.to_ndarray(format='rgb24').tobytes()).hexdigest()
def integer(value,name,minimum=0):
    if isinstance(value,bool) or not isinstance(value,int) or value<minimum:raise ValueError('invalid_integer:'+name)
    return value
def local_file(value):
    if not isinstance(value,str) or '://' in value or value.startswith(('\\\\','//')) or not Path(value).is_file() or Path(value).suffix.lower() not in {'.mp4','.mov','.mkv','.webm','.avi'}:raise ValueError('invalid_local_video')
    return Path(value)
def fraction_fps(request):
    value=request['fps'];fps=Fraction(integer(value['numerator'],'fps numerator',1),integer(value['denominator'],'fps denominator',1))
    if fps>60:raise ValueError('unsupported_fps')
    return fps
def open_video(path):return av.open(str(path),options={'protocol_whitelist':'file,pipe'})

def probe(path,selected=()):
    path=local_file(str(path));before=digest(path);selected=set(selected)
    for i in selected:integer(i,'probe frame')
    with open_video(path) as container:
        if len(container.streams.video)!=1 or len(container.streams.audio)>1:raise ValueError('unsupported_stream_count')
        stream=container.streams.video[0];fps=stream.average_rate;width=stream.width;height=stream.height
        if not fps or not 0<fps<=60 or stream.width%2 or stream.height%2:raise ValueError('unsupported_video_spec')
        audio=[]
        for a in container.streams.audio:
            if a.start_time is not None and a.start_time*a.time_base!=0:raise ValueError('audio_start_offset_unsupported')
            audio.append({'sampleRate':a.codec_context.sample_rate,'channels':a.codec_context.channels,'codec':a.codec_context.name})
        frames=[];count=0
        for frame in container.decode(video=0):
            if frame.pts is None or frame.time_base is None or Fraction(frame.pts)*frame.time_base!=Fraction(count,1)/fps:raise ValueError('source_not_zero_based_cfr')
            if count in selected:frames.append({'frame':count,'pts':frame.pts,'timeBase':str(frame.time_base),'rgbSha256':rgb_hash(frame)})
            count+=1
            if count>6000:raise ValueError('source_frame_budget_exceeded')
        if not count or any(i>=count for i in selected):raise ValueError('frame_out_of_bounds')
        if stream.duration is not None and Fraction(stream.duration)*stream.time_base!=Fraction(count,1)/fps:raise ValueError('source_duration_mismatch')
    if audio:
        samples=0
        with open_video(path) as container:
            for frame in container.decode(audio=0):
                if frame.pts is None or frame.time_base is None or frame.sample_rate!=audio[0]['sampleRate'] or Fraction(frame.pts)*frame.time_base!=Fraction(samples,audio[0]['sampleRate']):raise ValueError('source_audio_not_contiguous_zero_based')
                samples+=frame.samples
        audio[0]['decodedSamples']=samples;audio[0]['contiguousPtsVerified']=True
    if digest(path)!=before:raise ValueError('source_changed_during_probe')
    return {'sourceSha256':before,'width':width,'height':height,'fps':{'numerator':fps.numerator,'denominator':fps.denominator},'frames':count,'duration':str(Fraction(count,1)/fps),'audio':audio,'selectedFrames':frames,'sourceUnchanged':True,'gpuUsed':False,'framesActuallyViewed':[],'qualityApproved':False}

def sample_index(frame,fps,rate=48000):
    exact=Fraction(frame*rate,1)/fps
    if exact.denominator!=1:raise ValueError('audio_boundary_not_sample_aligned')
    return exact.numerator

def validate(request):
    fps=fraction_fps(request);width=integer(request['width'],'width',16);height=integer(request['height'],'height',16)
    if width%2 or height%2 or width>8192 or height>8192:raise ValueError('unsupported_dimensions')
    segments=request['segments']
    if not isinstance(segments,list) or not 1<=len(segments)<=32:raise ValueError('invalid_segments')
    request.setdefault('audioPolicy','clip-and-silence')
    if request['audioPolicy'] not in {'omit','clip-and-silence'}:raise ValueError('explicit_audio_policy_required')
    if request.get('outputCodec','h264-rgb-lossless')!='h264-rgb-lossless':raise ValueError('unsupported_output_codec')
    total=0;previous=None;last_end={};sources={}
    for segment in segments:
        path=local_file(segment['sourceVideo']);key=str(path.resolve());sha=segment['sourceSha256']
        if not isinstance(sha,str) or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('invalid_source_hash')
        if key not in sources:sources[key]={'path':path,'sha':sha,'selected':set()}
        elif sources[key]['sha']!=sha:raise ValueError('conflicting_source_hash')
        integer(segment['sourceFrames'],'source frames',1)
        kind=segment['kind']
        if kind=='clip':
            start=integer(segment['startFrame'],'start frame');end=integer(segment['endFrameExclusive'],'end frame',1)
            if end<=start or end>segment['sourceFrames']:raise ValueError('invalid_clip_interval')
            if sha in last_end and start<last_end[sha]:raise ValueError('overlap_or_reverse_not_supported')
            last_end[sha]=end;length=end-start;sources[key]['selected'].update(range(start,end))
        elif kind=='hold':
            frame=integer(segment['frame'],'hold frame');length=integer(segment['frames'],'hold frames',1)
            if previous is None or previous['kind']!='clip' or str(local_file(previous['sourceVideo']).resolve())!=key or frame!=previous['endFrameExclusive']-1:raise ValueError('hold_must_reference_previous_clip_last_frame')
            if segment.get('reviewDeclaration')!='explicitly-reviewed-frame' or not isinstance(segment.get('frameRgbSha256'),str) or len(segment['frameRgbSha256'])!=64:raise ValueError('explicit_reviewed_frame_hash_required')
            sources[key]['selected'].add(frame)
        else:raise ValueError('unsupported_segment_kind')
        total+=length;previous=segment
    if total>6000 or width*height*total>150_000_000:raise ValueError('cpu_frame_budget_exceeded')
    if integer(request['expectedOutputFrames'],'expected frames',1)!=total:raise ValueError('expected_output_frames_mismatch')
    for key,source in sources.items():
        if digest(source['path'])!=source['sha']:raise ValueError('source_hash_mismatch')
        info=probe(source['path'],source['selected']);source['info']=info
        if info['sourceSha256']!=source['sha']:raise ValueError('source_hash_mismatch')
        if info['width']!=width or info['height']!=height or Fraction(info['fps']['numerator'],info['fps']['denominator'])!=fps:raise ValueError('source_spec_mismatch_no_rescale_or_retime')
        for s in segments:
            if str(local_file(s['sourceVideo']).resolve())==key and s['sourceFrames']!=info['frames']:raise ValueError('source_frame_count_mismatch')
        source['rgbHashes']={f['frame']:f['rgbSha256'] for f in info['selectedFrames']}
    for s in segments:
        if s['kind']=='hold' and sources[str(local_file(s['sourceVideo']).resolve())]['rgbHashes'][s['frame']]!=s['frameRgbSha256']:raise ValueError('held_frame_rgb_hash_mismatch')
    has_audio=request['audioPolicy']=='clip-and-silence' and any(s['info']['audio'] for s in sources.values())
    specs={(v['info']['audio'][0]['sampleRate'],v['info']['audio'][0]['channels']) for v in sources.values() if v['info']['audio']} if has_audio else set()
    if len(specs)>1:raise ValueError('mixed_audio_specs_no_implicit_resampling')
    rate,channels=next(iter(specs)) if specs else (48000,2)
    if not 8000<=rate<=192000 or channels not in (1,2):raise ValueError('unsupported_audio_spec')
    if has_audio:
        sample_index(total,fps,rate)
        for segment in segments:
            sample_index(segment['startFrame'] if segment['kind']=='clip' else 0,fps,rate)
            sample_index(segment['endFrameExclusive'] if segment['kind']=='clip' else segment['frames'],fps,rate)
    return fps,width,height,total,sources,has_audio,rate,channels

def pcm_decode(ffmpeg,path,rate=48000,channels=2):
    command=[str(ffmpeg),'-nostdin','-hide_banner','-loglevel','error','-threads','2','-hwaccel','none','-protocol_whitelist','file,pipe','-i',str(path),'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar',str(rate),'-ac',str(channels),'-f','s16le','pipe:1']
    return subprocess.run(command,check=True,capture_output=True).stdout

def run(request,output,ffmpeg):
    fps,width,height,total,sources,has_audio,rate,channels=validate(request)
    stride=channels*2
    output=Path(output);output.mkdir(parents=True,exist_ok=False);png=output/'lossless-frames';png.mkdir()
    for source in sources.values():
        if has_audio and source['info']['audio']:source['pcm']=pcm_decode(ffmpeg,source['path'],rate,channels)
        else:source['pcm']=None
        # 필요한 원본 장만 저장하며, source frame index와 RGB 해시를 보존합니다.
        saved={}
        with open_video(source['path']) as container:
            for i,frame in enumerate(container.decode(video=0)):
                if i in source['selected']:
                    saved[i]=frame.to_image().convert('RGB')
        source['images']=saved
    frames=[];boundaries=[];audio=bytearray();silent_samples=0
    for index,segment in enumerate(request['segments']):
        source=sources[str(local_file(segment['sourceVideo']).resolve())];begin=len(frames)
        indices=range(segment['startFrame'],segment['endFrameExclusive']) if segment['kind']=='clip' else [segment['frame']]*segment['frames']
        for native in indices:
            out_index=len(frames);source['images'][native].save(png/f'frame-{out_index:06}.png')
            frames.append({'outputFrame':out_index,'sourceAssetId':segment.get('sourceVideoAssetId'),'sourceFrame':native,'kind':segment['kind'],'rgbSha256':source['rgbHashes'][native]})
        count=len(frames)-begin
        if has_audio:
            samples=sample_index(count,fps,rate)
            if segment['kind']=='clip' and source['pcm'] is not None:
                start=sample_index(segment['startFrame'],fps,rate)*stride;end=sample_index(segment['endFrameExclusive'],fps,rate)*stride
                if end>len(source['pcm']):raise ValueError('source_audio_does_not_cover_selected_interval')
                audio.extend(source['pcm'][start:end])
            else:audio.extend(bytes(samples*stride));silent_samples+=samples
        boundaries.append({'segment':index,'kind':segment['kind'],'outputStartFrame':begin,'outputEndFrameExclusive':len(frames),'startSeconds':str(Fraction(begin,1)/fps),'endSeconds':str(Fraction(len(frames),1)/fps),'audioStartSample':sample_index(begin,fps,rate) if has_audio else None,'audioEndSampleExclusive':sample_index(len(frames),fps,rate) if has_audio else None,'sourceAudioStartSample':sample_index(segment['startFrame'],fps,rate) if has_audio and segment['kind']=='clip' and source['pcm'] is not None else None,'sourceAudioEndSampleExclusive':sample_index(segment['endFrameExclusive'],fps,rate) if has_audio and segment['kind']=='clip' and source['pcm'] is not None else None,'audioMode':'source-decoded-pcm' if has_audio and segment['kind']=='clip' and source['pcm'] is not None else 'explicit-silence' if has_audio else 'omitted'})
    video=output/'media-edit.mp4'
    command=[str(ffmpeg),'-nostdin','-hide_banner','-loglevel','error','-n','-threads','2','-framerate',str(fps),'-i',str(png/'frame-%06d.png')]
    if has_audio:
        (output/'audio.pcm').write_bytes(audio)
        command+=['-f','s16le','-ar',str(rate),'-ac',str(channels),'-i',str(output/'audio.pcm')]
    command+=['-map','0:v:0']+(['-map','1:a:0','-c:a','alac','-sample_fmt','s16p'] if has_audio else ['-an'])
    command+=['-c:v','libx264rgb','-preset','veryfast','-crf','0','-threads','2','-pix_fmt','rgb24','-bf','0','-r',str(fps),'-video_track_timescale',str(fps.numerator),'-frames:v',str(total),'-map_metadata','-1','-movflags','+faststart',str(video)]
    subprocess.run(command,check=True,capture_output=True)
    with open_video(video) as container:
        stream=container.streams.video[0];seen=0
        for frame in container.decode(video=0):
            if frame.pts is None or Fraction(frame.pts)*frame.time_base!=Fraction(seen,1)/fps:raise RuntimeError('output_pts_mismatch')
            if rgb_hash(frame)!=frames[seen]['rgbSha256']:raise RuntimeError('decoded_source_frame_changed')
            seen+=1
        if seen!=total or stream.average_rate!=fps or Fraction(stream.duration)*stream.time_base!=Fraction(total,1)/fps:raise RuntimeError('output_duration_or_frames_mismatch')
        if len(container.streams.audio)!=int(has_audio):raise RuntimeError('output_audio_tracks_mismatch')
        time_base=str(stream.time_base)
    if has_audio and pcm_decode(ffmpeg,video,rate,channels)!=bytes(audio):raise RuntimeError('output_pcm_samples_mismatch')
    audio_time_base=None
    if has_audio:
        samples=0
        with open_video(video) as container:
            stream=container.streams.audio[0];audio_time_base=str(stream.time_base)
            for frame in container.decode(audio=0):
                if frame.pts is None or frame.time_base is None or frame.sample_rate!=rate or Fraction(frame.pts)*frame.time_base!=Fraction(samples,rate):raise RuntimeError('output_audio_pts_mismatch')
                samples+=frame.samples
            if samples!=len(audio)//stride or stream.start_time!=0 or Fraction(stream.duration)*stream.time_base!=Fraction(samples,rate):raise RuntimeError('output_audio_duration_mismatch')
    for source in sources.values():
        if digest(source['path'])!=source['sha']:raise RuntimeError('source_changed_during_render')
    report={'status':'generated','video':str(video),'videoSha256':digest(video),'width':width,'height':height,'fps':str(fps),'frames':total,'duration':str(Fraction(total,1)/fps),'outputTimeBase':time_base,'boundaries':boundaries,'frameProvenance':frames,'allDecodedSourceFramesExact':True,'audioPolicy':request['audioPolicy'],'audioTracks':int(has_audio),'audioSampleRate':rate if has_audio else None,'audioChannels':channels if has_audio else None,'audioSamples':len(audio)//stride if has_audio else 0,'insertedSilentSamples':silent_samples,'decodedPcmExact':True if has_audio else None,'originalCompressedPacketsPreserved':False,'audioResampled':False,'gpuUsed':False,'originalUnchanged':True,'sourceHashes':[{'assetId':next((s.get('sourceVideoAssetId') for s in request['segments'] if str(local_file(s['sourceVideo']).resolve())==str(v['path'].resolve())),None),'sha256':v['sha']} for v in sources.values()],'codec':'h264-rgb-lossless','registrationRequired':True,'qualityApproved':False,'primaryChanged':False,'continuousPlaybackVerified':False,'actualHearing':False,'framesActuallyViewed':[],'reviewDeclarationsAreCallerProvided':True}
    report['pixelComparisonFormat']='rgb24'
    report['audioComparisonFormat']=f'{channels}ch-s16le-{rate}' if has_audio else None
    report['audioTimeBase']=audio_time_base
    report['allDecodedAudioPtsVerified']=True if has_audio else None
    report['nativeFloatAudioBitExactClaim']=False
    (output/'result.json').write_text(json.dumps(report,indent=2),encoding='utf8');return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--output-directory',required=True);parser.add_argument('--ffmpeg',required=True);args=parser.parse_args()
    request=json.loads(Path(args.request).read_text(encoding='utf8'))
    if request.get('operation')=='probe':return {'status':'probed',**probe(request['sourceVideo'],request.get('selectedFrames',[]))}
    return run(request,args.output_directory,args.ffmpeg)
if __name__=='__main__':
    try:print(json.dumps(main()))
    except Exception as error:print(json.dumps({'status':'error','error':str(error),'qualityApproved':False,'originalMutationPerformed':False}));raise SystemExit(1)
