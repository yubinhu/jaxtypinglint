"""Open this file in VS Code; no Python packages need to be installed to hover.

Hover channel_mean at its definition or call below. Hover image inside the body.
Enable jaxtypinglint.signatureHelp to see the full annotations while typing calls.
This file is an editor demo, not a script to execute.
"""

from jaxtyping import Float, Bool
from torch import Tensor
from imported import crop


def channel_mean(
    image: Float[Tensor, "batch channels height width"],
    mask: Bool[Tensor, "batch height width"] | None = None,
) -> Float[Tensor, "batch channels"]:
    """Return each channel's spatial mean; mask is shown for annotation demo only."""
    return image.mean(dim=(-2, -1))


images: Float[Tensor, "batch channels height width"]
summary = channel_mean(images)

# With Pylance's go-to-definition available, hover imported function calls too.
photo: Float[Tensor, "height width channels"]
thumbnail = crop(photo)

# Intentional annotation error: only one variadic axis is permitted.
invalid_shape: Float[Tensor, "*batch ... channels"]
