Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\assets\icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$sizes = @(16,32,48,64,128,180,192,512)
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size,$size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255,11,13,16))
  $radius = [int]($size * 0.22)
  $rect = New-Object System.Drawing.Rectangle(0,0,$size,$size)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,217,242,180))
  $font = New-Object System.Drawing.Font('Georgia', [float]($size * 0.62), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('M', $font, $brush, [System.Drawing.RectangleF]::new(0, -($size*0.05), $size, $size), $format)
  $name = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}
# SVG icon
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Moneta">
  <defs>
    <radialGradient id="g" cx="35%" cy="28%" r="85%">
      <stop offset="0%" stop-color="#22341f"/>
      <stop offset="100%" stop-color="#0b0d10"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="256" y="372" text-anchor="middle" font-family="Georgia, serif" font-size="330" font-style="italic" font-weight="700" fill="#d9f2b4">M</text>
</svg>
'@
Set-Content -Path (Join-Path $dir 'icon.svg') -Value $svg -Encoding UTF8
Write-Host "icons created"