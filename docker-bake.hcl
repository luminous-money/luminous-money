# Every image in the stack, plus the test suites and contract checks.
#
#   docker buildx bake             build every service image for this machine
#   docker buildx bake test        run every test suite and contract check
#   docker buildx bake generate    export ledger's OpenAPI schema into packages/ledger-client
#   docker buildx bake e2e ui-tests  build the end-to-end test images (run them with `pnpm e2e`)
#   docker buildx bake release     build linux/amd64 + linux/arm64 and push (set REGISTRY, VERSION)
#
# The root package.json wraps these as `pnpm build`, `pnpm test`, `pnpm generate`, `pnpm release`.

variable "REGISTRY" {
  default = "fava-beans"
}

variable "VERSION" {
  default = "dev"
}

group "default" {
  targets = ["ledger", "app", "fava"]
}

group "test" {
  targets = ["ledger-test", "workspace-check"]
}

group "release" {
  targets = ["ledger-release", "app-release", "fava-release"]
}

# Service images

target "ledger" {
  context = "services/ledger"
  tags    = ["${REGISTRY}/ledger:${VERSION}"]
}

target "app" {
  context    = "."
  dockerfile = "services/app/Dockerfile"
  contexts = {
    workspace = "target:workspace"
  }
  tags = ["${REGISTRY}/app:${VERSION}"]
}

target "fava" {
  context = "deploy/fava"
  tags    = ["${REGISTRY}/fava:${VERSION}"]
}

# The TypeScript workspace, installed once and shared by every TypeScript image

target "workspace" {
  context    = "."
  dockerfile = "node.Dockerfile"
  target     = "workspace"
  output     = ["type=cacheonly"]
}

# Tests and contracts

target "ledger-test" {
  context = "services/ledger"
  target  = "test"
  tags    = ["${REGISTRY}/ledger:test"]
}

target "ledger-openapi" {
  context = "services/ledger"
  target  = "openapi"
  output  = ["type=cacheonly"]
}

target "generate" {
  inherits = ["ledger-openapi"]
  output   = ["type=local,dest=packages/ledger-client"]
}

# Typechecks the TypeScript workspace and fails if generated clients have drifted from the
# services they describe.
target "workspace-check" {
  context    = "."
  dockerfile = "node.Dockerfile"
  target     = "check"
  contexts = {
    ledger-openapi = "target:ledger-openapi"
  }
  output = ["type=cacheonly"]
}

# The end-to-end suites (API and browser), run against a throwaway stack by scripts/e2e.sh

target "e2e" {
  context    = "."
  dockerfile = "node.Dockerfile"
  target     = "e2e"
  tags       = ["${REGISTRY}/e2e:${VERSION}"]
}

target "ui-tests" {
  context    = "."
  dockerfile = "node.Dockerfile"
  target     = "ui"
  tags       = ["${REGISTRY}/ui-tests:${VERSION}"]
}

# Release: both architectures (the Pi is arm64), pushed to REGISTRY

target "_release" {
  platforms = ["linux/amd64", "linux/arm64"]
  output    = ["type=registry"]
}

target "ledger-release" {
  inherits = ["ledger", "_release"]
}

target "app-release" {
  inherits = ["app", "_release"]
}

target "fava-release" {
  inherits = ["fava", "_release"]
}
