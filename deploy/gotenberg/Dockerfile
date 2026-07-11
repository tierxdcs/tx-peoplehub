# Gotenberg — document-conversion microservice for the Vault preview pipeline.
# Deployed as its OWN Railway service, separate from the main API. Uses the
# official image as-is (no custom build); this Dockerfile exists only so
# Railway has something to build and so the version is pinned in-repo.
#
# The main API reaches it over HTTP at GOTENBERG_URL and POSTs Office docs to
# /forms/libreoffice/convert (see VaultPreviewService).
FROM gotenberg/gotenberg:8

# Gotenberg listens on 3000 by default. Railway sets $PORT; bind to it.
# Shell form so ${PORT} expands (exec form runs no shell). --api-timeout
# gives LibreOffice room for large documents.
CMD gotenberg --api-port=${PORT:-3000} --api-timeout=120s
