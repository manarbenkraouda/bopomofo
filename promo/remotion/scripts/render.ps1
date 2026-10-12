# Render the promo with Remotion. Run from promo/remotion: pwsh -File scripts/render.ps1
# This PC is Windows on ARM64. The Remotion compositor has no ARM64 Windows build,
# so the render runs on an x64 Node (Windows x64 emulation) kept in .tools/.
$node = Resolve-Path ".tools/node-v24.20.0-win-x64" -ErrorAction SilentlyContinue
if (-not $node) {
  New-Item -ItemType Directory -Force .tools | Out-Null
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip" -OutFile ".tools/node-x64.zip"
  Expand-Archive -LiteralPath ".tools/node-x64.zip" -DestinationPath ".tools" -Force
  Remove-Item -LiteralPath ".tools/node-x64.zip"
  $node = Resolve-Path ".tools/node-v24.20.0-win-x64"
}
if (-not (Test-Path "node_modules/@remotion/compositor-win32-x64-msvc")) {
  npm install --no-save --force @remotion/compositor-win32-x64-msvc@4.0.535 @rspack/binding-win32-x64-msvc@1.7.11 @rspack/binding-win32-arm64-msvc@1.7.11
}
$env:Path = $node.Path + ";" + $env:Path
npx remotion render BopomofoPromo ../bopomofo-promo-remotion-45s-60fps.mp4 --codec h264 --pixel-format yuv420p --audio-codec aac
