# Border flood-fill background remover (compiled C# core for speed).
# Removes light background CONNECTED to the image border, stopping at the
# character's dark outline. Interior light areas (white troll muscles) survive
# because the flood cannot cross the outline to reach them.
#
# Usage: powershell -File remove-bg.ps1 -In src.png -Out cut.png [-Bright 232] [-Feather 1] [-Crop]
param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Bright = 232,
  [int]$Feather = 1,
  [switch]$Crop
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class BgRemover {
  public static void Run(string inPath, string outPath, int bright, int feather, bool crop) {
    using (Bitmap src = (Bitmap)Image.FromFile(inPath)) {
      int w = src.Width, h = src.Height;
      Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (Graphics gfx = Graphics.FromImage(bmp)) { gfx.DrawImage(src, 0, 0, w, h); }

      Rectangle rect = new Rectangle(0, 0, w, h);
      BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int stride = data.Stride;
      byte[] bytes = new byte[stride * h];
      Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);

      int n = w * h;
      bool[] isBg = new bool[n];
      for (int y = 0; y < h; y++) {
        int row = y * stride;
        for (int x = 0; x < w; x++) {
          int o = row + x * 4;
          int b = bytes[o], gr = bytes[o+1], r = bytes[o+2];
          int min = b < gr ? b : gr; if (r < min) min = r;
          isBg[y * w + x] = (min >= bright);
        }
      }

      bool[] removed = new bool[n];
      Stack<int> st = new Stack<int>(n / 4);
      for (int x = 0; x < w; x++) { st.Push(x); st.Push((h-1)*w + x); }
      for (int y = 0; y < h; y++) { st.Push(y*w); st.Push(y*w + (w-1)); }

      while (st.Count > 0) {
        int i = st.Pop();
        if (removed[i] || !isBg[i]) continue;
        removed[i] = true;
        int x = i % w, y = i / w;
        if (x > 0    && !removed[i-1]) st.Push(i-1);
        if (x < w-1  && !removed[i+1]) st.Push(i+1);
        if (y > 0    && !removed[i-w]) st.Push(i-w);
        if (y < h-1  && !removed[i+w]) st.Push(i+w);
      }

      for (int i = 0; i < n; i++) {
        if (removed[i]) { int y = i / w, x = i % w; bytes[y*stride + x*4 + 3] = 0; }
      }

      if (feather > 0) {
        byte[] aCopy = new byte[n];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) aCopy[y*w+x] = bytes[y*stride + x*4 + 3];
        for (int y = 1; y < h-1; y++) {
          for (int x = 1; x < w-1; x++) {
            int i = y*w+x;
            if (aCopy[i] == 0) continue;
            if (removed[i-1] || removed[i+1] || removed[i-w] || removed[i+w]) {
              byte a = aCopy[i]; bytes[y*stride + x*4 + 3] = (byte)(a < 170 ? a : 170);
            }
          }
        }
      }

      Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
      bmp.UnlockBits(data);

      Bitmap final = bmp;
      if (crop) {
        int minX = w, minY = h, maxX = 0, maxY = 0;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
          if (!removed[y*w+x]) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        int pad = 6;
        minX = Math.Max(0, minX - pad); minY = Math.Max(0, minY - pad);
        maxX = Math.Min(w-1, maxX + pad); maxY = Math.Min(h-1, maxY + pad);
        int cw = maxX - minX + 1, ch = maxY - minY + 1;
        final = bmp.Clone(new Rectangle(minX, minY, cw, ch), PixelFormat.Format32bppArgb);
        Console.WriteLine("Cropped to " + cw + "x" + ch + " (from " + w + "x" + h + ")");
      }

      final.Save(outPath, ImageFormat.Png);
      Console.WriteLine("Saved " + outPath);
    }
  }
}
"@

[BgRemover]::Run((Resolve-Path $In).Path, $Out, $Bright, $Feather, [bool]$Crop)
