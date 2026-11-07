"""A separate module for trying imported-function hovers with Pylance."""

from jaxtyping import Float
from torch import Tensor


def crop(image: Float[Tensor, "height width channels"]) -> Float[Tensor, "crop_h crop_w channels"]:
    return image[:16, :16]
