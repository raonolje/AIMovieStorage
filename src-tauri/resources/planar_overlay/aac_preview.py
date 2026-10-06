"""Offline CPU compatibility derivative. Never replaces the lossless master."""
from pathlib import Path
from fractions import Fraction
import argparse, hashlib, json, subprocess
import av

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def inspect(path):
    with av.open(str(path),options={'protocol_whitelist':'file,pipe'}) as c:
        if len(c.streams)!=2 or len(c.streams.video)!=1 or len(c.streams.audio)!=1:raise ValueError('exactly_one_video_and_audio_required')
        v,a=c.streams.video[0],c.streams.audio[0]
        if v.codec_context.name!='h264' or a.codec_context.channels not in (1,2) or a.codec_context.sample_rate not in (24000,44100,48000):raise ValueError('unsupported_preview_streams')
        if v.start_time!=0 or a.start_time!=0 or v.duration is None or a.duration is None:raise ValueError('zero_based_exact_track_duration_required')
        duration=Fraction(v.duration)*v.time_base
        if duration!=Fraction(a.duration)*a.time_base or not 0<duration<=300:raise ValueError('matched_track_duration_required')
        if (duration*a.codec_context.sample_rate).denominator!=1:raise ValueError('non_sample_aligned_duration')
        packets=[];audio_packets=[]
        for p in c.demux():
            if not p.size:continue
            item={'pts':str(Fraction(p.pts)*p.time_base),'dts':str(Fraction(p.dts)*p.time_base),'duration':str(Fraction(p.duration)*p.time_base),'sha256':hashlib.sha256(bytes(p)).hexdigest()}
            (packets if p.stream.type=='video' else audio_packets).append(item)
        info={'videoCodec':'h264','audioCodec':a.codec_context.name,'sampleRate':a.codec_context.sample_rate,'channels':a.codec_context.channels,'duration':str(duration),'timelineSamples':int(duration*a.codec_context.sample_rate),'videoPackets':packets,'audioPackets':audio_packets}
    frames=[]
    with av.open(str(path)) as c:
        for f in c.decode(video=0):
            if len(frames)>=6000 or (len(frames)+1)*f.width*f.height>150_000_000:raise ValueError('cpu_frame_budget_exceeded')
            frames.append({'pts':str(Fraction(f.pts)*f.time_base),'rgbSha256':hashlib.sha256(f.to_ndarray(format='rgb24').tobytes()).hexdigest()})
    info['frames']=frames
    samples=0
    with av.open(str(path)) as c:
        for f in c.decode(audio=0):
            if Fraction(f.pts)*f.time_base!=Fraction(samples,f.sample_rate):raise ValueError('decoded_audio_gap_or_offset')
            samples+=f.samples
    info['decodedSamples']=samples
    return info

def export(request,directory,ffmpeg):
    source=Path(request['sourceVideo'])
    if '://' in str(source) or str(source).startswith(('\\\\','//')) or not source.is_file():raise ValueError('invalid_local_master')
    before=digest(source)
    if before!=request['sourceSha256']:raise ValueError('source_hash_mismatch')
    original=inspect(source)
    if original['audioCodec']!='alac' or original['decodedSamples']!=original['timelineSamples']:raise ValueError('lossless_alac_master_required')
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True);out=directory/'aac-preview.mp4'
    if out.exists():raise ValueError('existing_output_preserved')
    duration=float(Fraction(original['duration']))
    cmd=[str(ffmpeg),'-hide_banner','-loglevel','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',str(source),'-map','0:v:0','-map','0:a:0','-map_metadata','-1','-c:v','copy','-c:a','aac','-b:a','192k','-t',format(duration,'.12f'),'-video_track_timescale','48000','-movie_timescale','48000','-movflags','+faststart',str(out)]
    subprocess.run(cmd,check=True,capture_output=True)
    made=inspect(out)
    if original['videoPackets']!=made['videoPackets'] or original['frames']!=made['frames']:raise ValueError('video_packets_or_frames_changed')
    if made['duration']!=original['duration'] or made['audioCodec']!='aac' or made['sampleRate']!=original['sampleRate'] or made['channels']!=original['channels']:raise ValueError('preview_audio_timeline_changed')
    extra=made['decodedSamples']-made['timelineSamples']
    if not 0<=extra<1024:raise ValueError('unexpected_aac_tail_padding')
    first=Fraction(made['audioPackets'][0]['pts']);delay=-first*made['sampleRate']
    if delay.denominator!=1 or not 0<=delay<=2048:raise ValueError('unexpected_encoder_delay')
    if digest(source)!=before:raise ValueError('master_changed')
    subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-nostdin','-xerror','-i',str(out),'-f','null','-'],check=True,capture_output=True)
    return {'status':'generated','gpuUsed':False,'originalUnchanged':True,'masterSha256':before,'outputSha256':digest(out),'lossyAudio':True,'audioCodec':'aac','bitrate':192000,'videoStreamCopied':True,'allVideoPacketsExact':True,'allDecodedFramesExact':True,'videoFrames':len(made['frames']),'duration':made['duration'],'sampleRate':made['sampleRate'],'channels':made['channels'],'timelineSamples':made['timelineSamples'],'decodedSamplesIncludingTailPadding':made['decodedSamples'],'encoderDelaySamples':int(delay),'decoderTailPaddingSamples':extra,'paddingPolicy':'MP4 edit list removes encoder priming; track duration excludes decoder tail padding. Raw AAC decoded samples can include that tail.','fullDecodePassed':True,'playbackVerified':False,'listeningVerified':False,'qualityApproved':False,'videoPackets':made['videoPackets'],'audioPackets':made['audioPackets']}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--output-directory',required=True);p.add_argument('--ffmpeg',required=True);a=p.parse_args()
    try:print(json.dumps(export(json.loads(Path(a.request).read_text(encoding='utf-8')),a.output_directory,a.ffmpeg)))
    except Exception as e:print(json.dumps({'status':'error','error':str(e)}));raise SystemExit(1)
