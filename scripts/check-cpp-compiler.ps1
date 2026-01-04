# Script to check C++ compiler availability

Write-Host "Checking for C++ compiler..." -ForegroundColor Cyan

# Check 1: Find cl.exe in PATH
$clPath = Get-Command cl -ErrorAction SilentlyContinue
if ($clPath) {
    Write-Host "[OK] Compiler found: $($clPath.Source)" -ForegroundColor Green
    exit 0
}

Write-Host "[FAIL] Compiler not found in PATH" -ForegroundColor Yellow
Write-Host ""

# Check 2: Find Visual Studio in standard locations
Write-Host "Searching for Visual Studio Build Tools..." -ForegroundColor Cyan

$vsPaths = @(
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
    "C:\Program Files\Microsoft Visual Studio\2022\Community",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise"
)

$foundVs = $null
foreach ($path in $vsPaths) {
    if (Test-Path $path) {
        $vcvarsPath = Join-Path $path "VC\Auxiliary\Build\vcvars64.bat"
        if (Test-Path $vcvarsPath) {
            $foundVs = $vcvarsPath
            Write-Host "[OK] Found Visual Studio: $path" -ForegroundColor Green
            break
        }
    }
}

if (-not $foundVs) {
    Write-Host "[FAIL] Visual Studio Build Tools not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "SOLUTION:" -ForegroundColor Yellow
    Write-Host "1. Make sure Visual Studio Build Tools are installed" -ForegroundColor White
    Write-Host "2. Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor White
    Write-Host "3. During installation, select 'C++ build tools'" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use Developer Command Prompt:" -ForegroundColor Yellow
    Write-Host "- Press Win + S" -ForegroundColor White
    Write-Host "- Type 'Developer Command Prompt'" -ForegroundColor White
    Write-Host "- Run 'Developer Command Prompt for VS 2022'" -ForegroundColor White
    exit 1
}

Write-Host ""
Write-Host "Environment setup..." -ForegroundColor Cyan
Write-Host "Path to vcvars64.bat: $foundVs" -ForegroundColor Gray

$vcvarsDir = Split-Path $foundVs -Parent
$vcvarsFile = Split-Path $foundVs -Leaf

Write-Host ""
Write-Host "Run these commands:" -ForegroundColor Yellow
Write-Host "cd '$vcvarsDir'" -ForegroundColor White
Write-Host "cmd /c $vcvarsFile && set" -ForegroundColor White
Write-Host ""
Write-Host "Or use Developer Command Prompt (recommended):" -ForegroundColor Yellow
Write-Host "- Win + S -> 'Developer Command Prompt' -> 'Developer Command Prompt for VS 2022'" -ForegroundColor White
Write-Host "- In that window run: pip install madmom" -ForegroundColor White

