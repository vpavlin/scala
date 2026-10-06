{
  description = "Scala Calendar UI — pure-QML view over the scala core module";

  inputs = {
    # port/0.3: builder 0.3.1 — the SAME builder the scala core and loam_core use.
    logos-module-builder.url = "github:logos-co/logos-module-builder/0.3.1";
    scala.url = "github:vpavlin/scala/7af46fa7c091f8bae683bd9862f1aa83cebc4f74";
    # The view also calls loam_core directly (identities, keycard enrol, node status), so it
    # declares it: Basecamp 0.3 gives each view its own identity and checks what it may call.
    loam_core.url = "github:vpavlin/loam-basecamp/f66ad0ac8973a314f17eca12e4ce0b9939b1a19a?dir=core";
  };

  outputs = inputs@{ logos-module-builder, scala, ... }:
    logos-module-builder.lib.mkLogosQmlModule {
      src = ./.;
      configFile = ./metadata.json;
      flakeInputs = inputs;
    };
}
