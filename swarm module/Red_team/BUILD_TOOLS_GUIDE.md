# Visual Studio Build Tools - Installation Guide

For compiling Python packages on Windows, you need the **C++ build tools**.

## Quick Setup

### 1. In the Visual Studio Installer (shown in your screenshot):

**Select this workload:**
- ☑ **Desktop development with C++** (under "Desktop & Mobile")

This includes:
- MSVC (Microsoft Visual C++ compiler)
- Windows SDK
- CMake
- MSBuild

### 2. Individual Components (Alternative)

If you prefer minimal installation, go to the **"Individual components"** tab and select:
- ☑ **MSVC v143 - VS 2022 C++ x64/x86 build tools** (Latest)
- ☑ **Windows 11 SDK** (or Windows 10 SDK)
- ☑ **C++ CMake tools for Windows**

### 3. Click Install

After selecting, click the **"Install"** button (bottom right).

## Size

- Desktop development with C++: ~7-8 GB
- Individual components only: ~2-3 GB

## After Installation

Once installed, you can install the full requirements:

```powershell
cd "swarm module\Red_team"
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Alternative: Skip Build Tools

If you don't want to install build tools, use the Windows-specific requirements that only use pre-built packages:

```powershell
pip install -r requirements-windows.txt
```

Most functionality will work without the build tools.
