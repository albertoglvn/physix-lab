"""Compact U-Net for unit-traction stress fields on the ``physix.raster/1`` grid.

Only ONNX operators that both ``onnxruntime`` and ``onnxruntime-web`` support are used
(Conv, BatchNormalization folded at export, Sigmoid/Mul for SiLU, MaxPool, Resize, Concat).
"""

from __future__ import annotations

from typing import Any

import torch
from torch import nn

from data.raster import FEATURE_CHANNELS, TARGET_CHANNELS


class ConvBlock(nn.Module):
    def __init__(self, c_in: int, c_out: int) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv2d(c_in, c_out, 3, padding=1, bias=False),
            nn.BatchNorm2d(c_out),
            nn.SiLU(),
            nn.Conv2d(c_out, c_out, 3, padding=1, bias=False),
            nn.BatchNorm2d(c_out),
            nn.SiLU(),
        )
        self.skip = nn.Conv2d(c_in, c_out, 1) if c_in != c_out else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.body(x) + self.skip(x)


class UNet(nn.Module):
    """Four-level U-Net: 64 x 128 -> 8 x 16 bottleneck and back."""

    def __init__(
        self,
        in_channels: int = len(FEATURE_CHANNELS),
        out_channels: int = len(TARGET_CHANNELS),
        base: int = 24,
        depth: int = 3,
    ) -> None:
        super().__init__()
        self.config = {
            "in_channels": in_channels,
            "out_channels": out_channels,
            "base": base,
            "depth": depth,
        }
        widths = [base * 2**k for k in range(depth + 1)]
        self.down = nn.ModuleList()
        c = in_channels
        for w in widths[:-1]:
            self.down.append(ConvBlock(c, w))
            c = w
        self.pool = nn.MaxPool2d(2)
        self.bottleneck = ConvBlock(c, widths[-1])
        self.up = nn.ModuleList()
        c = widths[-1]
        for w in reversed(widths[:-1]):
            self.up.append(ConvBlock(c + w, w))
            c = w
        self.head = nn.Conv2d(c, out_channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        skips = []
        for block in self.down:
            x = block(x)
            skips.append(x)
            x = self.pool(x)
        x = self.bottleneck(x)
        for block, skip in zip(self.up, reversed(skips), strict=True):
            x = nn.functional.interpolate(x, scale_factor=2.0, mode="bilinear", align_corners=False)
            x = block(torch.cat([x, skip], dim=1))
        return self.head(x)


class PhysicalModel(nn.Module):
    """U-Net with normalization baked in: raw features in, masked physical targets out."""

    def __init__(self, net: UNet, target_mean: torch.Tensor, target_std: torch.Tensor) -> None:
        super().__init__()
        self.net = net
        self.register_buffer("target_mean", target_mean.reshape(1, -1, 1, 1).float())
        self.register_buffer("target_std", target_std.reshape(1, -1, 1, 1).float())

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        mask = features[:, 0:1]
        return (self.net(features) * self.target_std + self.target_mean) * mask


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def build_model(config: dict[str, Any] | None = None) -> UNet:
    return UNet(**(config or {}))
