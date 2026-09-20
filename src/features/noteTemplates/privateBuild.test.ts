import { expect, it } from "vitest";
import config from "../../../src-tauri/tauri.conf.json";
import script from "../../../src-tauri/installer-private.nsi?raw";
import hooks from "../../../src-tauri/nsis-hooks.nsh?raw";

it("keeps display branding separate from Windows installation identity", () => {
  expect(config.productName).toBe("花笺");
  expect(config.identifier).toBe("com.regulusapplex.floral.notepaper");
  expect(config.bundle.windows.nsis.template).toBe("installer-private.nsi");
  expect(script).toContain('!define PRIVATE_INSTALL_NAME "floral-notepaper-regulusapplex"');
  expect(script).toContain("Uninstall\\${PRIVATE_INSTALL_NAME}");
  expect(script).toContain('CurrentVersion\\Run" "${PRIVATE_INSTALL_NAME}"');
  expect(script).not.toContain("EnumRegKey");
  expect(script).not.toContain("!insertmacro APP_ASSOCIATE");
  expect(script).not.toContain("!insertmacro APP_UNASSOCIATE");
  expect(script).toContain('${If} ${FileExists} "$DESKTOP\\${PRODUCTNAME}.lnk"');
  expect(hooks).not.toContain("${PRODUCTNAME}");
  expect(script).toMatch(
    /Function CreateOrUpdateStartMenuShortcut[\s\S]*?\$SMPROGRAMS\\\$AppStartMenuFolder\\\$\{PRODUCTNAME\}\.lnk/,
  );
});
