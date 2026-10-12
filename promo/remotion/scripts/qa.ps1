# QA: extract frames every 1 s plus each shot boundary, then make a labelled contact sheet.
# Run from promo/remotion: pwsh -File scripts/qa.ps1
$video = "../bopomofo-promo-remotion-45s-60fps.mp4"
$qa = "qa-45s"
New-Item -ItemType Directory -Force $qa | Out-Null
Get-ChildItem -LiteralPath $qa -Filter "f*.jpg" | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
$times = @(0.3, 1, 2, 2.4, 2.6, 3, 4, 4.9, 5.1, 6, 7, 8, 8.9, 9.1, 10, 11, 11.4, 11.6, 12, 13, 14, 15, 15.4, 15.6, 16, 17, 18, 19, 20, 20.4, 20.6, 21, 22, 23, 23.4, 23.6, 24, 25, 26, 26.4, 26.55, 26.7, 27, 27.5, 28, 28.5, 29, 29.5, 29.95)
$times = $times | ForEach-Object { [math]::Min($_ * 1.5, 44.95) }  # 45 s cut: storyboard times x 1.5
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$font = "/Windows/Fonts/arialbd.ttf"
$i = 0
foreach ($t in $times) {
  $i++
  $ts = $t.ToString("0.00", $inv)
  $label = $ts + "s"
  $out = "$qa/f{0:D2}.jpg" -f $i
  ffmpeg -hide_banner -loglevel error -y -ss $ts -i $video -frames:v 1 -vf "drawtext=fontfile=$($font):text=$($label):x=20:y=20:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10" -q:v 3 $out
}
ffmpeg -hide_banner -loglevel error -y -framerate 1 -i "$qa/f%02d.jpg" -vf "scale=270:480,tile=7x7:padding=6:color=white" -frames:v 1 "$qa/contact-sheet.png"
Write-Output ("frames: " + (Get-ChildItem -LiteralPath $qa -Filter "f*.jpg").Count)
