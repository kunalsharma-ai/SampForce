# Builds the page and serves it with nginx on port 8080.
#   docker build -t sampforce-website .
#   docker run -p 8080:8080 sampforce-website
# For a sub-path:  docker build --build-arg BASE_PATH=/products/sampforce/ -t sampforce-website .
FROM node:22-alpine AS build
WORKDIR /app
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
