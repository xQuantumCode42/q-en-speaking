param([switch]$SkipGpu)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot 'native\whisper'
$modelPath = Join-Path $projectRoot 'native\models'
$downloadPath = Join-Path $projectRoot '.test-data\speech-setup'
foreach ($path in @($runtimePath, $modelPath, $downloadPath)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}
function Get-VerifiedFile([string]$Url, [string]$Path, [string]$Hash) {
    if ((Test-Path -LiteralPath $Path) -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Hash) { return }
    & curl.exe --fail --location --retry 2 --connect-timeout 20 --max-time 600 --output ($Path + '.part') $Url
    if ($LASTEXITCODE -ne 0) { throw 'Speech component download failed. Please run setup:speech again.' }
    if ((Get-FileHash -LiteralPath ($Path + '.part') -Algorithm SHA256).Hash -ne $Hash) { throw 'Speech component checksum mismatch.' }
    Move-Item -LiteralPath ($Path + '.part') -Destination $Path -Force
}
$archive = Join-Path $downloadPath 'whisper-bin-x64-v1.8.2.zip'
Get-VerifiedFile 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip' $archive 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732'
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $downloadPath 'runtime') -Force
foreach ($name in @('whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll')) {
    Copy-Item -LiteralPath (Join-Path $downloadPath ('runtime\Release\' + $name)) -Destination (Join-Path $runtimePath $name) -Force
}
Get-VerifiedFile 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin' (Join-Path $modelPath 'ggml-small.en-q5_1.bin') 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30'
if (-not $SkipGpu) {
    $gpuArchive = Join-Path $downloadPath 'whisper-cuda-v1.8.2.zip'
    Get-VerifiedFile 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-cublas-12.4.0-bin-x64.zip' $gpuArchive '54a3c012e6c567e2e8bed874cdf49c55f018ec8d90bb5d5271568aa573291b2d'
    $gpuExtract = Join-Path $downloadPath 'cuda'
    Expand-Archive -LiteralPath $gpuArchive -DestinationPath $gpuExtract -Force
    $gpuRuntime = Join-Path $projectRoot 'native\whisper-cuda'
    New-Item -ItemType Directory -Path $gpuRuntime -Force | Out-Null
    $gpuCli = Get-ChildItem -LiteralPath $gpuExtract -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
    if (-not $gpuCli) { throw 'GPU speech executable not found in verified archive.' }
    Copy-Item -LiteralPath $gpuCli.FullName -Destination $gpuRuntime -Force
    Get-ChildItem -LiteralPath $gpuCli.DirectoryName -Filter '*.dll' | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $gpuRuntime -Force
    }
}
Write-Output 'Local English Whisper components are ready.'
