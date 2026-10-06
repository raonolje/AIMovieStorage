"""LTX 생성 음원 보존. 대사 조건/A2V나 청취·립싱크 검수가 아니다."""
from fractions import Fraction
from pathlib import Path
import os
import subprocess
import tempfile
import numpy as np


def validate_audio(audio, sample_rate, frames, fps):
    if audio is None:
        raise ValueError('generated_audio_missing')
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, int) or not 8000 <= sample_rate <= 192000:
        raise ValueError('generated_audio_invalid_sample_rate')
    if hasattr(audio, 'detach'):
        audio = audio.detach().float().cpu().numpy()
    samples = np.asarray(audio)
    # 설치된 LTX vocoder 문서의 B,C,T 계약만 허용한다. 채널/시간 추측 금지.
    if samples.ndim != 3 or samples.shape[0] != 1 or samples.shape[1] not in (1, 2):
        raise ValueError('generated_audio_expected_batch_channels_samples')
    if not np.issubdtype(samples.dtype, np.floating) or not np.isfinite(samples).all():
        raise ValueError('generated_audio_nonfinite_or_nonfloat')
    if samples.size == 0 or float(np.abs(samples).max()) > 1.0:
        raise ValueError('generated_audio_clipping_or_empty')
    count = Fraction(frames * sample_rate, 1) / Fraction(str(fps))
    if count.denominator != 1 or count <= 0:
        raise ValueError('generated_audio_unaligned_duration')
    if samples.shape[2] < count:
        raise ValueError('generated_audio_shorter_than_video')
    pcm = samples[0, :, :int(count)].T.astype('<f4', copy=True)
    return pcm, {'source': 'model-generated', 'sample_rate': sample_rate,
        'channels': samples.shape[1], 'samples': int(count),
        'original_samples': samples.shape[2], 'trimmed_tail_samples': samples.shape[2] - int(count),
        'peak': float(np.abs(pcm).max()), 'rms': float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))),
        'signal_present': bool(np.any(pcm != 0)),
        'finite_verified': True, 'clipping_detected': False, 'actual_hearing': False,
        'lip_sync_verified': False, 'continuous_playback_verified': False}


def save_generated_video(frames, audio, sample_rate, output, fps, save_video):
    import av
    import imageio_ffmpeg
    pcm, metadata = validate_audio(audio, sample_rate, len(frames), fps)
    output = Path(output)
    wav = output.with_suffix('.generated-audio.wav')
    if wav.exists() or output.exists():
        raise FileExistsError('generated_output_would_overwrite_existing_media')
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    def execute(args, data=None):
        subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
                        '-threads', '2', *args], input=data, capture_output=True, check=True)
    with tempfile.TemporaryDirectory(prefix='generated-audio-', dir=output.parent) as work:
        silent = Path(work) / 'frames.mp4'
        master = Path(work) / 'audio.wav'
        muxed = Path(work) / 'muxed.mp4'
        execute(['-f', 'f32le', '-ar', str(sample_rate), '-ac', str(pcm.shape[1]),
                 '-i', 'pipe:0', '-c:a', 'pcm_f32le', str(master)], pcm.tobytes())
        # WAV는 float32 원음을 유지하고 MP4는 호환성 높은 AAC로 저장한다.
        decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(master), '-f', 'f32le',
                                  '-c:a', 'pcm_f32le', 'pipe:1'], capture_output=True, check=True).stdout
        if decoded != pcm.tobytes():
            raise RuntimeError('generated_audio_wav_not_exact')
        save_video(frames, str(silent), fps)
        execute(['-i', str(silent), '-i', str(master), '-map', '0:v:0', '-map', '1:a:0',
                 '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-map_metadata', '-1',
                 '-movflags', '+faststart', str(muxed)])
        duration = Fraction(len(frames), 1) / Fraction(str(fps))
        with av.open(str(muxed)) as container:
            if len(container.streams.audio) != 1 or len(container.streams.video) != 1:
                raise RuntimeError('generated_audio_output_streams_missing')
            a = container.streams.audio[0]
            v = container.streams.video[0]
            if a.codec_context.sample_rate != sample_rate or a.codec_context.channels != pcm.shape[1] or a.start_time != 0:
                raise RuntimeError('generated_audio_output_spec_mismatch')
            if a.duration is None or abs(Fraction(a.duration) * a.time_base - duration) > Fraction(1, sample_rate):
                raise RuntimeError('generated_audio_output_duration_mismatch')
            if v.duration is None or Fraction(v.duration) * v.time_base != duration:
                raise RuntimeError('generated_video_output_duration_mismatch')
        with av.open(str(muxed)) as container:
            seen = 0
            for frame in container.decode(audio=0):
                if frame.pts is None or Fraction(frame.pts) * frame.time_base != Fraction(seen, sample_rate):
                    raise RuntimeError('generated_audio_output_pts_mismatch')
                if not np.isfinite(frame.to_ndarray()).all():
                    raise RuntimeError('generated_audio_output_nonfinite')
                seen += frame.samples
            # AAC는 마지막 코덱 블록을 패딩한다. 컨테이너 길이와 원음 길이를 별도 기록한다.
            if not len(pcm) <= seen < len(pcm) + 1024:
                raise RuntimeError('generated_audio_output_sample_count_mismatch')
        # 검증 후만 공개한다. 기존 파일을 덮어쓰지 않는 배타적 생성.
        with wav.open('xb') as target:
            target.write(master.read_bytes())
        os.link(muxed, output)
    metadata.update(wav_path=str(wav), wav_float32_exact=True, mp4_codec='aac',
                    mp4_lossless=False, decoded_aac_samples=seen, aac_padding_samples=seen-len(pcm),
                    stream_pts_verified=True, output_audio_tracks=1)
    return metadata
