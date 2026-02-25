.PHONY: install lint typecheck test verify build ci

install:
	npm install --no-audit --no-fund

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

verify:
	npm run verify

build:
	npm run build

ci:
	npm run ci
