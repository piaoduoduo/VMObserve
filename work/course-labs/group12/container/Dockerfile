FROM hub.oepkgs.net/openeuler/openeuler:22.03-lts
RUN yum install -y gcc
WORKDIR /app
COPY hello.c /app/
RUN gcc -o hello hello.c
CMD ["/app/hello"]