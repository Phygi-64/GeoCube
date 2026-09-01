@echo off
set "JAVA_HOME=C:\Program Files\Java\jdk-21"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Java version:
java -version
echo.
echo Building APK...
cd android
call gradlew.bat assembleDebug
echo.
if %ERRORLEVEL% == 0 (
    echo BUILD SUCCESS!
    echo APK: android\app\build\outputs\apk\debug\app-debug.apk
) else (
    echo BUILD FAILED! Code: %ERRORLEVEL%
)
