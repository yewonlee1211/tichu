import numpy as np
import torch


def test_numpy_is_importable():
    assert np.array([1, 2, 3]).sum() == 6


def test_torch_is_importable_and_computes():
    tensor = torch.tensor([1.0, 2.0, 3.0])
    assert tensor.sum().item() == 6.0
