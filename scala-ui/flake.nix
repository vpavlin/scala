{
  description = "Scala Calendar UI — pure-QML view over the scala core module";

  inputs = {
    # port/0.3: builder 0.3.1 — the SAME builder the scala core and loam_core use.
    logos-module-builder.url = "github:logos-co/logos-module-builder/0.3.1";
    scala.url = "github:vpavlin/scala/1c59fa68b7ff972f74d70a6eceb3408536e0ae17";
    # The view also calls loam_core directly (identities, keycard enrol, node status), so it
    # declares it: Basecamp 0.3 gives each view its own identity and checks what it may call.
    loam_core.url = "github:vpavlin/loam-basecamp/7ec67c43c9357e787945eb731388c5dc89d31b7c?dir=core";
  };

  outputs = inputs@{ logos-module-builder, scala, ... }:
    logos-module-builder.lib.mkLogosQmlModule {
      src = ./.;
      configFile = ./metadata.json;
      flakeInputs = inputs;
    };
}
