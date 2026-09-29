FROM node:22.12.0-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm install --force

COPY . .

RUN npm run build 

FROM nginx:stable

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist/frontend-new/browser /usr/share/nginx/html

EXPOSE 80
