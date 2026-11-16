"""本地提取视频元数据与带时间码的关键帧索引，不上传素材、不改动源视频。"""

import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def run(command):
    """参数用列表传给进程，确保中文路径和空格不被命令行二次解释。"""
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "视频处理命令执行失败")
    return result.stdout


def find_binary(name, directory):
    """优先使用调用方指定的工具目录，避免依赖本机专有的安装路径。"""
    if directory:
        binary = Path(directory) / (name + ".exe")
        if binary.is_file():
            return str(binary)
        binary = Path(directory) / name
        if binary.is_file():
            return str(binary)
    binary = shutil.which(name)
    if not binary:
        raise FileNotFoundError(f"找不到 {name}；请通过 --ffmpeg-dir 指定已安装工具所在目录")
    return binary


def timecode(seconds):
    minutes, seconds = divmod(seconds, 60)
    return f"{int(minutes):02d}:{seconds:06.3f}"


def contact_sheet(frames, target):
    """仅为分析生成缩略索引；保留原比例，完整帧另外保存以便核对细节。"""
    width, image_height, caption_height = 480, 270, 30
    sheet = Image.new("RGB", (width * 3, (image_height + caption_height) * math.ceil(len(frames) / 3)), "#e8e7e3")
    draw = ImageDraw.Draw(sheet)
    font_path = Path("C:/Windows/Fonts/consola.ttf")
    font = ImageFont.truetype(str(font_path), 17) if font_path.is_file() else ImageFont.load_default()
    for index, frame in enumerate(frames):
        x, y = (index % 3) * width, (index // 3) * (image_height + caption_height)
        with Image.open(frame["absolute_path"]) as image:
            image.thumbnail((width, image_height))
            sheet.paste(image, (x + (width - image.width) // 2, y + (image_height - image.height) // 2))
        draw.text((x + 12, y + image_height + 5), frame["timecode"], font=font, fill="#141513")
    sheet.save(target, quality=92)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="视频文件或需要递归扫描的视频目录")
    parser.add_argument("--output", type=Path, required=True, help="分析产物目录")
    parser.add_argument("--ffmpeg-dir", help="包含 ffmpeg 和 ffprobe 的目录；不指定则使用 PATH")
    parser.add_argument("--count", type=int, default=12, help="每个视频等间隔抽样数量")
    parser.add_argument("--times", default="", help="额外抽样秒数，以逗号分隔；超出某个视频长度的时间会忽略")
    args = parser.parse_args()
    if args.count < 2:
        parser.error("--count 至少为 2")
    extra_times = [float(value) for value in args.times.split(",") if value.strip()]
    ffmpeg = find_binary("ffmpeg", args.ffmpeg_dir)
    ffprobe = find_binary("ffprobe", args.ffmpeg_dir)
    videos = [args.source] if args.source.is_file() else sorted(path for path in args.source.rglob("*") if path.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv", ".avi"})
    if not videos:
        parser.error("源路径下未找到视频")
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {"source": str(args.source.resolve()), "method": "ffprobe metadata + ffmpeg decoded frame extraction", "videos": []}
    for video_index, video in enumerate(videos, 1):
        metadata = json.loads(run([ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(video)]))
        streams = metadata.get("streams", [])
        stream = next(item for item in streams if item.get("codec_type") == "video")
        duration = float(stream.get("duration") or metadata["format"]["duration"])
        # 末帧前留 0.1 秒，以免音轨比视频长或容器尾部无可解码图像。
        last_sample = max(0, duration - 0.1)
        times = sorted(set(round(last_sample * index / (args.count - 1), 3) for index in range(args.count)) | {value for value in extra_times if 0 <= value <= last_sample})
        folder = args.output / f"{video_index:02d}_{video.stem}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        frames = []
        for seconds in times:
            target = folder / f"frame_{round(seconds * 1000):07d}ms.png"
            # -ss 放在输入之前使用解码器准确寻帧；关闭音轨且输出一张完整视频帧。
            run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(seconds), "-i", str(video), "-an", "-frames:v", "1", "-update", "1", str(target)])
            if not target.is_file():
                raise RuntimeError(f"未成功输出帧：{video.name} @ {seconds}")
            frames.append({"seconds": seconds, "timecode": timecode(seconds), "absolute_path": str(target.resolve())})
        sheet = folder / "contact-sheet.jpg"
        contact_sheet(frames, sheet)
        entry = {"source": str(video.resolve()), "duration_seconds": duration, "width": stream["width"], "height": stream["height"], "fps_fraction": stream.get("avg_frame_rate"), "has_audio_track": any(item.get("codec_type") == "audio" for item in streams), "contact_sheet": str(sheet.resolve()), "frames": frames}
        manifest["videos"].append(entry)
        print(f"{video.name}: {duration:.3f}s, {stream['width']}x{stream['height']}, {len(frames)} frames", flush=True)
    manifest_path = args.output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    # 写入后重新解析，确保生成的索引可供后续流程直接读取。
    loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"Verified manifest: {len(loaded['videos'])} videos, {manifest_path.resolve()}")


if __name__ == "__main__":
    main()
