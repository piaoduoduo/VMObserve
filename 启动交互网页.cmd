@echo off
cd /d "%~dp0"

py -3 -B -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
    set "VMOBSERVE_PYTHON=py -3"
) else (
    python -B -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
    if errorlevel 1 (
        echo VMObserve requires Python 3.10 or newer.
        pause
        exit /b 1
    )
    set "VMOBSERVE_PYTHON=python"
)

echo Open http://127.0.0.1:8766/ after the server starts.
echo Press Ctrl+C to stop the server.
%VMOBSERVE_PYTHON% -B work/launch.py --executor local --port 8766
pause
