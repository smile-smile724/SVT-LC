# edge-service

`edge-service` is intentionally left as a thin placeholder in the scaffold.

It should eventually own:

- cache key design for `sem / coarse / residual`
- TTL rules
- Redis metadata and invalidation messages
- MinIO object layout
- NGINX integration notes

Recommended order:

1. Finish `web-client`, `preprocess`, and `scheduler-service`.
2. Add object storage layout for processed scenes.
3. Introduce Redis metadata and hot-block counters.
4. Put NGINX in front of MinIO and test `sem + coarse` edge reuse first.
