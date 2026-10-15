/*
	contentLoader.ts  (shared)

	Runs Luau content modules. A content module is a ModuleScript that
	returns one function; that function is called with the `WC` API table:

		return function(WC)
			WC.AddAbility({ ... })
		end

	Loaded: every ModuleScript directly in the folder, or in Folders inside
	it. ModuleScripts *inside* a ModuleScript are left alone, so a content
	module can keep its own helper modules as children.

	One broken module is reported and skipped; the rest still load.
*/

function collect(container: Instance, out: ModuleScript[]) {
	for (const child of container.GetChildren()) {
		if (child.IsA("ModuleScript")) out.push(child);
		else if (child.IsA("Folder")) collect(child, out);
	}
}

export function loadContent(folder: Instance | undefined, api: object, label: string) {
	if (!folder) return;

	const modules: ModuleScript[] = [];
	collect(folder, modules);
	// Stable order: by full path, so loads are the same every time.
	modules.sort((a, b) => a.GetFullName() < b.GetFullName());

	for (const module of modules) {
		const name = `${label}/${module.GetFullName().sub(folder.GetFullName().size() + 2)}`;

		const [ok, result] = pcall(require, module);
		if (!ok) {
			warn(`[WorldsCollide] ${name} crashed while loading: ${result}`);
			continue;
		}
		if (!typeIs(result, "function")) {
			warn(`[WorldsCollide] ${name} must "return function(WC) ... end" (it returned a ${typeOf(result)})`);
			continue;
		}
		const [ran, err] = pcall(result as (wc: object) => void, api);
		if (!ran) warn(`[WorldsCollide] ${name} errored: ${err}`);
	}
}
