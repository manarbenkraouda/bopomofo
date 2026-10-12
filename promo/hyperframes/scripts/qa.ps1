# QA + final encode for the Bopomofo HyperFrames promo.
# Usage (from promo\hyperframes):  powershell -ExecutionPolicy Bypass -File scripts\qa.ps1
$ErrorActionPreference = "Stop"
$hfRoot = Split-Path -Parent $PSScriptRoot
$render = Join-Path $hfRoot "renders\promo-45s-60fps.mp4"
$final = Join-Path (Split-Path -Parent $hfRoot) "bopomofo-promo-hyperframes-45s-60fps.mp4"
$qaDir = Join-Path $hfRoot "qa-45s"
$thumbDir = Join-Path $qaDir "_thumbs"

# 1. Final encode: H.264 yuv420p, 60 fps CFR, AAC, exactly 45 s.
ffmpeg -hide_banner -loglevel error -y -i $render -map 0:v:0 -map 0:a:0 -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 60 -fps_mode cfr -c:a aac -b:a 192k -ar 48000 -t 45 -movflags +faststart $final

# 2. Frames: every 1 s, shot boundaries, and the end hold.
New-Item -ItemType Directory -Force -Path $qaDir, $thumbDir | Out-Null
Get-ChildItem -LiteralPath $qaDir -Filter "frame_*.png" | Remove-Item
Get-ChildItem -LiteralPath $thumbDir -Filter "*.png" | Remove-Item
$times = @(0.5) + (1..44) + @(3.75, 7.5, 13.5, 17.25, 23.25, 30.75, 35.25, 39.75, 42.75, 44.9)
$times = $times | ForEach-Object { [double]$_ } | Sort-Object -Unique
$i = 0
foreach ($t in $times) {
  $label = $t.ToString("00.0", [Globalization.CultureInfo]::InvariantCulture)
  $ts = $t.ToString([Globalization.CultureInfo]::InvariantCulture)
  ffmpeg -hide_banner -loglevel error -y -ss $ts -i $final -frames:v 1 (Join-Path $qaDir "frame_$label.png")
  $vf = "scale=270:480,drawtext=fontfile='C\:/Windows/Fonts/arialbd.ttf':text='$label s':x=8:y=8:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6"
  ffmpeg -hide_banner -loglevel error -y -i (Join-Path $qaDir "frame_$label.png") -vf $vf (Join-Path $thumbDir ("t_{0:D3}.png" -f $i))
  $i++
}

# 3. Contact sheet (8 columns).
$rows = [math]::Ceiling($i / 8)
ffmpeg -hide_banner -loglevel error -y -framerate 1 -i (Join-Path $thumbDir "t_%03d.png") -vf "tile=8x$($rows):padding=6:margin=6:color=0x24201b" -frames:v 1 (Join-Path $qaDir "contact-sheet.png")

# 4. End hold: the last 2.25 s must be still.
$ErrorActionPreference = "Continue"   # ffmpeg writes its log to stderr
"--- freezedetect from 42.45 s (expect freeze_start <= 42.75 and no freeze_end) ---"
cmd /c "ffmpeg -hide_banner -ss 42.45 -i `"$final`" -vf freezedetect=n=0.0005:d=1.0 -an -f null - 2>&1" | Select-String "freeze_"

# 5. Probe.
"--- ffprobe ---"
ffprobe -v error -show_entries "format=duration,size:stream=index,codec_name,codec_type,pix_fmt,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels,duration,nb_frames" -of default=noprint_wrappers=1 $final
"frames: $i  contact sheet: $(Join-Path $qaDir 'contact-sheet.png')"

