"""Request headers for the two fake signed-in users of the API tests. The client fixture (conftest.py) maps each token
to a user id, so no real Clerk token is checked."""

A = {"Authorization": "Bearer token-a"}  # user_a
B = {"Authorization": "Bearer token-b"}  # user_b
