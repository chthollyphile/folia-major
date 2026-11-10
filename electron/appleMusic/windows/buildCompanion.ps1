param()
$ErrorActionPreference = 'Stop'

# Build on Windows with Visual Studio/MSBuild. Only SDK/loader assemblies are shipped, not a browser runtime.
if ($env:OS -ne 'Windows_NT') { throw 'Build this companion on Windows.' }
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$outputDirectory = Join-Path $repositoryRoot 'build/apple-music-native/windows'
$project = Join-Path $PSScriptRoot 'FoliaAppleMusicCompanion.csproj'
$msbuild = Get-Command msbuild -ErrorAction SilentlyContinue
if ($msbuild) {
    & $msbuild.Source $project /restore /p:Configuration=Release "/p:RestoreSources=https://api.nuget.org/v3/index.json" "/p:OutputPath=$outputDirectory/" /nologo
} else {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path $vswhere)) { throw 'Install Visual Studio Build Tools with .NET desktop build tools and .NET Framework 4.8 targeting pack.' }
    $resolved = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild/**/Bin/MSBuild.exe' | Select-Object -First 1
    if (-not $resolved) { throw 'MSBuild was not found.' }
    & $resolved $project /restore /p:Configuration=Release "/p:RestoreSources=https://api.nuget.org/v3/index.json" "/p:OutputPath=$outputDirectory/" /nologo
}
if ($LASTEXITCODE -ne 0) { throw 'Native companion build failed.' }
Write-Output (Join-Path $outputDirectory 'FoliaAppleMusicCompanion.exe')
