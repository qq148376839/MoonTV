@echo off
chcp 65001 >nul
git add .
git commit -F commit-msg.txt
if %errorlevel% equ 0 (
    echo Commit successful, pulling from origin...
    git pull origin main
) else (
    echo Commit failed, please check the errors above.
    pause
)
