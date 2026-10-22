@echo off
chcp 65001 >nul
title رفع المشروع إلى GitHub
echo ================================================================
echo   جاري رفع مشروع نموذج محاكاة وزارة الخارجية إلى GitHub...
echo   الرابط: https://github.com/anasmhmdforwork/MFA.git
echo ================================================================
echo.
git push -u origin main
echo.
if %errorlevel% neq 0 (
    echo [تنبيه]: إذا ظهر خطأ Permission أو Repository not found:
    echo تأكد من الدخول على إعدادات الريبوزيتوري في GitHub وجعله Public
    echo أو تأكيد تسجيل الدخول بحساب anasmhmdforwork في النافذة المنبثقة.
) else (
    echo ================================================================
    echo   ✓ تم رفع المشروع بالكامل إلى GitHub بنجاح!
    echo ================================================================
)
pause
