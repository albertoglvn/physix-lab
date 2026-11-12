"""Train the five-member U-Net ensemble (``make train``).

Usage::

    python -m scripts.run_feature model.train --data data/generated/physix-ds-v1 --epochs 60

Each member is an independent U-Net with its own recorded seed (initialisation and data
order). Members train in parallel processes. Only the ``train`` split is used for fitting;
a group-held-out slice of it (``val``) is used for monitoring and best-epoch selection.
The calibration and test splits are never seen during training.

Loss: per sample and per load direction, a hotspot-weighted relative squared error over
solid pixels, ``sum w (p - r)^2 / sum w r^2`` with ``w = 1 + 4 (|r| / max |r|)^2``, so a
cantilever-like case with large bending stress and a gentle tension case count equally.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from data.dataset import load_dataset
from data.domain import assign_split

DEFAULT_DATA = Path("data/generated/physix-ds-v1")
DEFAULT_OUT = Path("model/checkpoints")
VAL_FRACTION = 0.1


def fit_normalization(targets: np.ndarray, masks: np.ndarray, rows: np.ndarray) -> dict[str, list]:
    """Per-channel mean and std of targets over solid pixels of the training rows."""
    total = np.zeros(targets.shape[1])
    total_sq = np.zeros(targets.shape[1])
    count = 0
    for i in rows:
        m = masks[i]
        t = np.asarray(targets[i], dtype=np.float64)[:, m]
        total += t.sum(axis=1)
        total_sq += (t**2).sum(axis=1)
        count += m.sum()
    mean = total / max(count, 1)
    std = np.sqrt(np.maximum(total_sq / max(count, 1) - mean**2, 1e-12))
    return {"mean": mean.tolist(), "std": std.tolist()}


def split_train_val(
    records: list[dict[str, Any]], train_rows: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    fit, val = [], []
    for i in train_rows:
        group = records[i]["group"]
        bucket = assign_split("val:" + group, {"val": VAL_FRACTION, "fit": 1 - VAL_FRACTION})
        (val if bucket == "val" else fit).append(i)
    return np.array(fit, dtype=np.int64), np.array(val, dtype=np.int64)


def relative_loss(pred, ref, mask):  # torch tensors (B, 6, R, C), (B, 1, R, C)
    import torch

    losses = []
    for sl in (slice(0, 3), slice(3, 6)):
        p, r = pred[:, sl] * mask, ref[:, sl] * mask
        peak = r.abs().amax(dim=(1, 2, 3), keepdim=True).clamp_min(1e-6)
        w = 1.0 + 4.0 * (r.abs() / peak) ** 2
        num = (w * (p - r) ** 2).sum(dim=(1, 2, 3))
        den = (w * r**2).sum(dim=(1, 2, 3)).clamp_min(1e-12)
        losses.append(num / den)
    return torch.stack(losses).mean()


def train_member(job: dict[str, Any]) -> dict[str, Any]:
    import torch

    from model.unet import PhysicalModel, UNet, count_parameters

    torch.set_num_threads(job["threads"])
    seed = job["seed"]
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    ds = load_dataset(job["data"])
    feats = ds.features()
    targets = ds.targets
    fit, val = np.array(job["fit"]), np.array(job["val"])
    norm = job["normalization"]
    net = UNet(**job["model_config"])
    model = PhysicalModel(net, torch.tensor(norm["mean"]), torch.tensor(norm["std"]))
    opt = torch.optim.AdamW(net.parameters(), lr=job["lr"], weight_decay=1e-4)
    steps_per_epoch = int(np.ceil(len(fit) / job["batch"]))
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=job["lr"], total_steps=job["epochs"] * steps_per_epoch, pct_start=0.15
    )

    def batch(rows: np.ndarray):
        rows = np.sort(rows)
        x = torch.from_numpy(np.asarray(feats[rows], dtype=np.float32))
        y = torch.from_numpy(np.asarray(targets[rows], dtype=np.float32))
        return x, y, x[:, 0:1]

    def evaluate(rows: np.ndarray) -> float:
        model.eval()
        total = 0.0
        with torch.no_grad():
            for k in range(0, len(rows), 64):
                x, y, m = batch(rows[k : k + 64])
                total += float(relative_loss(model(x), y, m)) * len(x)
        model.train()
        return total / max(len(rows), 1)

    history = []
    best = (float("inf"), None, -1)
    started = time.time()
    for epoch in range(job["epochs"]):
        order = rng.permutation(fit)
        running = 0.0
        for k in range(0, len(order), job["batch"]):
            x, y, m = batch(order[k : k + job["batch"]])
            loss = relative_loss(model(x), y, m)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            sched.step()
            running += loss.item() * len(x)
        val_loss = evaluate(val) if len(val) else float("nan")
        history.append({"epoch": epoch, "train": running / len(fit), "val": val_loss})
        if val_loss < best[0]:
            best = (val_loss, {k: v.clone() for k, v in model.state_dict().items()}, epoch)
        print(
            f"[train] member {job['member']} epoch {epoch + 1}/{job['epochs']} "
            f"train {running / len(fit):.4f} val {val_loss:.4f} ({time.time() - started:.0f} s)",
            file=sys.stderr,
            flush=True,
        )
    model.load_state_dict(best[1])
    out = Path(job["out"]) / f"member_{job['member']}.pt"
    torch.save(
        {
            "member": job["member"],
            "seed": seed,
            "model_config": job["model_config"],
            "normalization": norm,
            "state_dict": model.state_dict(),
            "best_epoch": best[2],
            "best_val": best[0],
            "history": history,
            "parameters": count_parameters(net),
            "dataset_id": ds.dataset_id,
        },
        out,
    )
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    return {
        "member": job["member"],
        "seed": seed,
        "file": out.name,
        "sha256": digest,
        "best_epoch": best[2],
        "best_val": best[0],
        "train_seconds": round(time.time() - started, 1),
    }


def train(
    data: Path,
    out_root: Path,
    members: int = 5,
    epochs: int = 60,
    batch: int = 16,
    lr: float = 2e-3,
    base_seed: int = 1000,
    parallel: int = 5,
    threads: int = 3,
    model_config: dict[str, Any] | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    ds = load_dataset(data)
    ds.features()  # compute and cache once before workers start
    train_rows = ds.indices("train")
    if limit:
        train_rows = train_rows[:limit]
    fit, val = split_train_val(ds.records, train_rows)
    norm = fit_normalization(ds.targets, ds.masks, fit)
    config = model_config or {"base": 24, "depth": 3}
    run_id = (
        "run-"
        + hashlib.sha256(
            json.dumps(
                [ds.dataset_id, members, epochs, batch, lr, base_seed, config, limit]
            ).encode()
        ).hexdigest()[:10]
    )
    out = out_root / run_id
    out.mkdir(parents=True, exist_ok=True)
    jobs = [
        {
            "member": k,
            "seed": base_seed + k,
            "data": str(data),
            "out": str(out),
            "fit": fit.tolist(),
            "val": val.tolist(),
            "normalization": norm,
            "model_config": config,
            "epochs": epochs,
            "batch": batch,
            "lr": lr,
            "threads": threads,
        }
        for k in range(members)
    ]
    started = time.time()
    if parallel > 1:
        with mp.get_context("spawn").Pool(min(parallel, members)) as pool:
            results = pool.map(train_member, jobs)
    else:
        results = [train_member(j) for j in jobs]
    run = {
        "schema": "physix.training_run/1",
        "run_id": run_id,
        "dataset_id": ds.dataset_id,
        "dataset_path": str(data),
        "fit_rows": len(fit),
        "val_rows": len(val),
        "normalization": norm,
        "model_config": config,
        "hyperparameters": {
            "epochs": epochs,
            "batch": batch,
            "lr": lr,
            "optimizer": "AdamW+OneCycle",
        },
        "loss": "hotspot-weighted relative squared error per load direction",
        "members": results,
        "wall_seconds": round(time.time() - started, 1),
    }
    (out / "run.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
    (out_root / "LATEST").write_text(run_id, encoding="utf-8")
    print(f"[train] wrote {out}", file=sys.stderr)
    return run


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Train the Physix U-Net ensemble")
    p.add_argument("--data", type=Path, default=DEFAULT_DATA)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--members", type=int, default=5)
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--seed", type=int, default=1000)
    p.add_argument("--parallel", type=int, default=5)
    p.add_argument("--threads", type=int, default=3)
    p.add_argument("--base", type=int, default=24, help="U-Net base width")
    p.add_argument("--limit", type=int, default=None, help="cap training rows (smoke runs)")
    a = p.parse_args(argv)
    train(
        a.data,
        a.out,
        a.members,
        a.epochs,
        a.batch,
        a.lr,
        a.seed,
        a.parallel,
        a.threads,
        {"base": a.base, "depth": 3},
        a.limit,
    )


if __name__ == "__main__":
    main()
