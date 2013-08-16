
test: lint
	@./node_modules/.bin/mocha -R spec

lint:
	@./node_modules/.bin/jshint --verbose *.js lib test

.PHONY: test lint
