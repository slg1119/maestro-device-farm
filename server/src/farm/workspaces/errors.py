class WorkspaceError(Exception):
    """A workspace operation failed in a way the API reports as {"error": {code, message, **extra}}."""

    def __init__(self, status: int, code: str, message: str, **extra) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra
