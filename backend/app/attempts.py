"""The first-try allowance. Attempt indexes start at zero; saved event counts start at one."""

FIRST_TRY_ATTEMPTS = 3


def first_try(ok: bool, help: bool, try_n: int) -> bool:
    return bool(ok and not help and 0 <= try_n < FIRST_TRY_ATTEMPTS)
