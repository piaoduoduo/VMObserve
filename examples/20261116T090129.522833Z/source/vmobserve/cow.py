"""Allowed COW interventions. Fractions select uniformly spaced base pages."""

COW_STRIDES = {"0": 0, "1/8": 8, "1/4": 4, "1/2": 2, "1": 1}
COW_CHOICES = (*COW_STRIDES, "all")


def cow_fractions(choice):
    if choice not in COW_CHOICES:
        raise ValueError("unsupported COW fraction")
    return tuple(COW_STRIDES) if choice == "all" else (choice,)
