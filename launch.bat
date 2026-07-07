@echo off
echo Starting App

start "Backend" cmd /k "cd /d D:\_Newer_\Money-logix-project\backend && npm run dev"
start "Frontend" cmd /k "cd /d D:\_Newer_\Money-logix-project\paper-trading-ui && npm run dev"

exit