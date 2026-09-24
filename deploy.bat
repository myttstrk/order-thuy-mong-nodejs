@echo off
set "PATH=%USERPROFILE%\AppData\Local\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd;%USERPROFILE%\AppData\Local\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;%PATH%"
echo Dang day code len GitHub de Vercel deploy...
git add .
git commit -m "Auto deploy update"
git pull origin main --rebase
git push origin main
if %ERRORLEVEL% equ 0 (
    echo.
    echo Deploy thanh cong! Vercel dang cap nhat tai: https://thuy-mong.vercel.app
) else (
    echo.
    echo Co loi xay ra khi push.
)
pause
