# Generates the Moneta web, Android and splash artwork from one palette.
# Run from the project root: powershell -ExecutionPolicy Bypass -File scripts/make-brand-assets.ps1
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$icons = Join-Path $root 'assets\icons'
$res = Join-Path $root 'android\app\src\main\res'
New-Item -ItemType Directory -Force -Path $icons | Out-Null

$ink = [System.Drawing.ColorTranslator]::FromHtml('#171819')
$dark = [System.Drawing.ColorTranslator]::FromHtml('#18191B')
$darkDeep = [System.Drawing.ColorTranslator]::FromHtml('#101112')
$mint = [System.Drawing.ColorTranslator]::FromHtml('#B8E9D0')
$paper = [System.Drawing.ColorTranslator]::FromHtml('#F4F4F2')

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-MonetaMark($g, [float]$size, [switch]$Italic) {
  $mintBrush = New-Object System.Drawing.SolidBrush($mint)
  $inkBrush = New-Object System.Drawing.SolidBrush($dark)
  $d = $size * 0.68
  $x = ($size - $d) / 2
  $g.FillEllipse($mintBrush, $x, $x, $d, $d)
  $style = if ($Italic) { [System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic } else { [System.Drawing.FontStyle]::Bold }
  $font = New-Object System.Drawing.Font('Georgia', [float]($size * 0.43), $style, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = [System.Drawing.RectangleF]::new($x, $x - ($size * 0.018), $d, $d)
  $g.DrawString('m', $font, $inkBrush, $rect, $format)
  $font.Dispose()
  $mintBrush.Dispose()
  $inkBrush.Dispose()
}

function New-Icon([int]$size, [string]$path, [switch]$Round, [switch]$Transparent, [switch]$Italic) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  if (-not $Transparent) {
    $pathShape = if ($Round) {
      $p = New-Object System.Drawing.Drawing2D.GraphicsPath
      $p.AddEllipse(0, 0, $size, $size)
      $p
    } else {
      New-RoundRect 0 0 $size $size ([float]($size * 0.22))
    }
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      [System.Drawing.Rectangle]::new(0, 0, $size, $size), $dark, $darkDeep, 55.0
    )
    $g.FillPath($brush, $pathShape)
    $brush.Dispose()
    $pathShape.Dispose()
  }
  Draw-MonetaMark $g ([float]$size) -Italic:$Italic
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

# Web icons
foreach ($size in @(16, 32, 48, 64, 128, 192)) {
  New-Icon $size (Join-Path $icons "icon-$size.png")
}
New-Icon 512 (Join-Path $icons 'icon-512.png')
New-Icon 180 (Join-Path $icons 'apple-touch-icon.png')

# Native splash mark: transparent, high resolution, matches the in-app loader.
$splashDir = Join-Path $res 'drawable-nodpi'
New-Item -ItemType Directory -Force -Path $splashDir | Out-Null
New-Icon 1024 (Join-Path $splashDir 'splash_mark.png') -Transparent -Italic
# Full app-icon plate used by the native launch overlay.
New-Icon 512 (Join-Path $splashDir 'launch_logo.png')

# Android legacy and adaptive launcher icons.
$densities = @{ 'mdpi' = 1; 'hdpi' = 1.5; 'xhdpi' = 2; 'xxhdpi' = 3; 'xxxhdpi' = 4 }
foreach ($entry in $densities.GetEnumerator()) {
  $dir = Join-Path $res "mipmap-$($entry.Key)"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  New-Icon ([int](48 * $entry.Value)) (Join-Path $dir 'ic_launcher.png')
  New-Icon ([int](48 * $entry.Value)) (Join-Path $dir 'ic_launcher_round.png') -Round
  New-Icon ([int](108 * $entry.Value)) (Join-Path $dir 'ic_launcher_foreground.png') -Transparent
}

# Splash screens keep the same pixel sizes as the Capacitor template.
Get-ChildItem $res -Recurse -Filter 'splash.png' | ForEach-Object {
  $source = [System.Drawing.Image]::FromFile($_.FullName)
  $w = $source.Width
  $h = $source.Height
  $source.Dispose()
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($paper)
  $min = [Math]::Min($w, $h)
  $mark = $min * 0.20
  $gx = ($w - $mark) / 2
  $gy = ($h / 2) - ($mark * 0.72)
  $mintBrush = New-Object System.Drawing.SolidBrush($mint)
  $g.FillEllipse($mintBrush, $gx, $gy, $mark, $mark)
  $mintBrush.Dispose()
  $inkBrush = New-Object System.Drawing.SolidBrush($ink)
  $font = New-Object System.Drawing.Font('Georgia', [float]($mark * 0.63), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('m', $font, $inkBrush, [System.Drawing.RectangleF]::new($gx, $gy - ($mark * 0.02), $mark, $mark), $format)
  $font.Dispose()
  $wordFont = New-Object System.Drawing.Font('Segoe UI Semibold', [float]($min * 0.055), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString('moneta', $wordFont, $inkBrush, [System.Drawing.RectangleF]::new(0, ($gy + $mark + ($min * 0.03)), $w, ($min * 0.1)), $format)
  $wordFont.Dispose()
  $inkBrush.Dispose()
  $g.Dispose()
  $bmp.Save($_.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Matching vector favicon.
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Moneta">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#202224"/>
      <stop offset="100%" stop-color="#101112"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <circle cx="256" cy="256" r="174" fill="#B8E9D0"/>
  <text x="256" y="366" text-anchor="middle" font-family="Georgia, serif" font-size="220" font-style="italic" font-weight="700" fill="#18191B">m</text>
</svg>
'@
Set-Content -Path (Join-Path $icons 'icon.svg') -Value $svg -Encoding UTF8
Write-Host 'Moneta brand assets generated.'
