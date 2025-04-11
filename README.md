## Benchmark

Pg vs SQLite benchmark in single thread Nodejs server

## Run benchmark

```
npx @blocklet/benchmark run
```

### docker run pg

```
docker run -d \
  --name test-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15
```
