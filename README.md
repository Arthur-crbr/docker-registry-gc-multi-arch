# DOCKER REGISTRY GARBAGE COLLECTOR MULTI ARCH
This is a Node.js-based garbage collector for Docker private registry containers. Since the default registry garbage collector does not handle manifest lists for multi-architecture builds, I developed a custom garbage collector using Node.js. It does not rely on Docker's API; instead, you must run this container alongside the Docker registry container because it directly accesses the Docker registry folder.

The data directory related to the Docker registry should not be included in the path.

# Build the container
docker build -t docker-registry-garbage-collector-multi-arch .

# Run the container
docker run -d \
  --name docker-registry-garbage-collector \
  --restart always \
  --pull always \
  --env GC_INTERVAL=3600000 \
  --volume /path/of/your/docker-registry:/registry \
  docker-registry-garbage-collector-multi-arch

# License
This project is open source and available under the MIT License.

Feel free to use, modify, and distribute the code according to the terms of the license. Contributions are welcome!