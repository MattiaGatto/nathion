# Rebuild static PWA icons from the same geometry as frontend/public/icon.svg.
Add-Type -AssemblyName System.Drawing
$outputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend/public'
foreach ($size in @(192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $scale = $size / 512.0
    $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#5eead4'), [single](38 * $scale))
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#080d14'))
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $points = [System.Drawing.PointF[]]@(
            [System.Drawing.PointF]::new([single](144 * $scale), [single](368 * $scale)),
            [System.Drawing.PointF]::new([single](144 * $scale), [single](144 * $scale)),
            [System.Drawing.PointF]::new([single](368 * $scale), [single](368 * $scale)),
            [System.Drawing.PointF]::new([single](368 * $scale), [single](144 * $scale))
        )
        $graphics.DrawLines($pen, $points)
        $bitmap.Save((Join-Path $outputDirectory ('icon-' + $size + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
