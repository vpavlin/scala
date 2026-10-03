{
  description = "scala engine + sync CORE module (delivery via the shared logos-transport).";
  inputs = {
    # port/0.3: builder 0.3.1 (Basecamp 0.3.x). scala routes sync through the loam_core FACADE
    # (ADR 0015), now on UPSTREAM delivery_module v0.3.0 (loam-basecamp port/0.3).
    logos-module-builder.url = "github:logos-co/logos-module-builder/0.3.1";
    loam_core.url = "github:vpavlin/loam-basecamp/7ec67c43c9357e787945eb731388c5dc89d31b7c?dir=core";
    # ADR 0017 Gate 3: attachments live in Logos Storage. Pinned (was: tracking master, which
    # silently pulled the 3.0 API break): v3.0.1 = libstorage v0.5.2.
    storage_module.url = "github:logos-co/logos-storage-module/v3.0.1";
  };
  outputs = inputs@{ logos-module-builder, ... }:
    logos-module-builder.lib.mkLogosModule {
      src = ./.;
      configFile = ./metadata.json;
      flakeInputs = inputs;
    };
}
