@echo off
node "%~dp0verify.mjs" %*
exit /b %errorlevel%
