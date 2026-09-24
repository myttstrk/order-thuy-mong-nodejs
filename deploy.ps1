$env:PATH = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
Write-Host "Dang luu va day code len GitHub de Vercel deploy..." -ForegroundColor Cyan

git add .
git commit -m "Update admin features"
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n>>> Push thanh cong! Vercel dang cap nhat trang web tai: https://thuy-mong.vercel.app" -ForegroundColor Green
} else {
    Write-Host "`n>>> Co loi khi push. Neu hien cua so dang nhap GitHub, ban hay dang nhap tren trinh duyet nhe." -ForegroundColor Yellow
}
