@echo off
rem Runs the Rust data-layer tests (plain "cargo test" cannot start on this machine).
setlocal
set "MINGW=C:\Users\Asus\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
set "PATH=%MINGW%;%PATH%"
cargo test --manifest-path "%~dp0Cargo.toml" %*
