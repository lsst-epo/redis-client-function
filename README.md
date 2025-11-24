# redis-client-function

The `redis-client` function stores and serves up data from Redis.

Typically, this function is called via `POST` request from `efd-client-function` and `GET` requests from Hasura.

## Deployment

First, build the typescript:

```
yarn build
```

The above command will create a `/dist` folder with the built Javascript.

Then, ensure your `gcloud` CLI is pointed at the correct GCP project and deploy the cloud function:

```
sh deploy.sh
```