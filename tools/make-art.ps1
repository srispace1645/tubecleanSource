# Generates TubeClean's launcher artwork as PNGs:
#   app/src/main/res/drawable/banner.png                 Fire TV / Android TV home-row banner (320x180)
#   app/src/main/res/mipmap-*/ic_launcher.png            app icon at every density (48..192 px)
# Launchers such as Fire OS 5's decode icons as bitmaps, so these must be raster images, not vector XML.
# Run after changing the design:  powershell -ExecutionPolicy Bypass -File tools\make-art.ps1
Add-Type -AssemblyName System.Drawing

$res = Join-Path $PSScriptRoot '..\app\src\main\res'
$red = [System.Drawing.Color]::FromArgb(255, 198, 40, 40)

# The shield-and-play mark, designed on a 48x48 grid (same as the original vector icon).
function Draw-Mark($g, [double]$scale, [double]$ox, [double]$oy, $shieldBrush, $playBrush) {
    function P([double]$x, [double]$y) { New-Object System.Drawing.PointF ([float]($ox + $x * $scale)), ([float]($oy + $y * $scale)) }
    $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shield.AddLine((P 24 8), (P 37 13))
    $shield.AddLine((P 37 13), (P 37 23))
    $shield.AddBezier((P 37 23), (P 37 31.5), (P 31.4 37.8), (P 24 40))
    $shield.AddBezier((P 24 40), (P 16.6 37.8), (P 11 31.5), (P 11 23))
    $shield.AddLine((P 11 23), (P 11 13))
    $shield.CloseFigure()
    $g.FillPath($shieldBrush, $shield)
    $g.FillPolygon($playBrush, [System.Drawing.PointF[]]@((P 20.5 17), (P 20.5 29), (P 30.5 23)))
}

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    return $bmp, $g
}

function Save-Png($bmp, [string]$path) {
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Wrote $path"
}

# ---- App icon: red rounded tile, white shield, red play triangle ----
$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($d in $densities.Keys) {
    $px = $densities[$d]
    $bmp, $g = New-Canvas $px $px
    $s = $px / 48.0
    $r = 8 * $s
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(2 * $s, 2 * $s, 2 * $r, 2 * $r, 180, 90)
    $tile.AddArc(46 * $s - 2 * $r, 2 * $s, 2 * $r, 2 * $r, 270, 90)
    $tile.AddArc(46 * $s - 2 * $r, 46 * $s - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $tile.AddArc(2 * $s, 46 * $s - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $red), $tile)
    Draw-Mark $g $s 0 0 ([System.Drawing.Brushes]::White) (New-Object System.Drawing.SolidBrush $red)
    Save-Png $bmp (Join-Path $res "mipmap-$d\ic_launcher.png")
    $g.Dispose(); $bmp.Dispose()
}

# ---- TV banner: dark gradient, red shield mark, "TubeClean" wordmark (Amazon requires text) ----
# Drawn at 640x360, saved at 320x180 in the default drawable folder: Fire OS 5's launcher only shows
# a banner from there (a drawable-xhdpi-only banner stays a blank placeholder tile).
$w = 640; $h = 360
$bmp, $g = New-Canvas $w $h
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $w, $h), ([System.Drawing.Color]::FromArgb(255, 33, 33, 33)), ([System.Drawing.Color]::FromArgb(255, 12, 12, 12))
$g.FillRectangle($bg, 0, 0, $w, $h)
Draw-Mark $g 4.2 40 80 (New-Object System.Drawing.SolidBrush $red) ([System.Drawing.Brushes]::White)
$title = New-Object System.Drawing.Font 'Segoe UI', 64, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sub = New-Object System.Drawing.Font 'Segoe UI', 30, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('TubeClean', $title, [System.Drawing.Brushes]::White, 250, 120)
$g.DrawString('ad-free YouTube', $sub, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 189, 189, 189))), 256, 200)
$small = New-Object System.Drawing.Bitmap 320, 180
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.InterpolationMode = 'HighQualityBicubic'
$sg.DrawImage($bmp, 0, 0, 320, 180)
Save-Png $small (Join-Path $res 'drawable\banner.png')
$sg.Dispose(); $small.Dispose(); $g.Dispose(); $bmp.Dispose()
