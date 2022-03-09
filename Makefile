
debug: dcompose
	npm run debug

#run the docker compose file
dcompose:
	docker-compose -f docker-compose/docker-compose.yaml up -d

dockerlite:
	docker-compose -f docker-compose/docker-compose.yaml up -d elasticsearch mongodb rollcall

# run all tests
verify:
	npm run test

stop:
	docker-compose  -f docker-compose/docker-compose.yaml down --remove-orphans 

# delete. everything.
nuke:
	docker-compose  -f docker-compose/docker-compose.yaml down --volumes --remove-orphans 
