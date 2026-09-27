"""Generate the four manual Colab notebooks from the shared implementation.

This script is a notebook *builder*, not a notebook itself: running it writes
out 01_eda.ipynb .. 04_federated.ipynb as plain .ipynb JSON files whose cells
just import and call the real fedhealth_ml/Module 4 code, so training and
Colab execution always share one implementation instead of duplicated logic.
"""
import json
from pathlib import Path
import textwrap

HERE = Path(__file__).resolve().parent


def md(text):
    """Build one markdown notebook cell from a (possibly indented) string."""
    return {"cell_type": "markdown", "metadata": {}, "source": textwrap.dedent(text).strip()}


def code(text):
    """Build one code notebook cell (no cached outputs/execution count)."""
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": textwrap.dedent(text).strip()}


# Cell shared by all four notebooks: clones the exact branch/commit into Colab
# (authenticating with a user-supplied GitHub token) and installs pinned deps,
# so every notebook run starts from an identical, verifiable checkout.
INSTALL = code('''
    import base64, os, sys, subprocess
    from pathlib import Path
    REPO = Path('/content/FedHealth-four-class')
    BRANCH = 'feat/four-class-ml-federation'
    if not REPO.exists():
        from google.colab import userdata
        try:
            token = userdata.get('GITHUB_TOKEN')
        except Exception as exc:
            raise RuntimeError('Add GITHUB_TOKEN in Colab Secrets and enable notebook access.') from exc
        if not token:
            raise RuntimeError('GITHUB_TOKEN is empty in Colab Secrets.')
        credential = base64.b64encode(f'x-access-token:{token.strip()}'.encode()).decode()
        env = os.environ.copy()
        env['GIT_TERMINAL_PROMPT'] = '0'
        env['GIT_CONFIG_COUNT'] = '1'
        env['GIT_CONFIG_KEY_0'] = 'http.https://github.com/.extraheader'
        env['GIT_CONFIG_VALUE_0'] = f'AUTHORIZATION: basic {credential}'
        result = subprocess.run(
            ['git', 'clone', '--branch', BRANCH, '--single-branch',
             'https://github.com/ahsen-dev86/FedHealth-FYP.git', str(REPO)],
            env=env, text=True, capture_output=True,
        )
        if result.returncode:
            raise RuntimeError(f'Git clone failed:\\n{result.stderr.strip()}')
    else:
        if not (REPO / '.git').is_dir():
            raise RuntimeError(f'{REPO} exists but is not a Git checkout')
        branch = subprocess.check_output(['git', '-C', str(REPO), 'branch', '--show-current'], text=True).strip()
        if branch != BRANCH:
            raise RuntimeError(f'Use a fresh runtime: existing checkout is {branch}')
    print('Branch:', BRANCH)
    print('Commit:', subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', '--short', 'HEAD'], text=True).strip())
    assert (3, 11) <= sys.version_info[:2] <= (3, 13), 'Use Python 3.11–3.13 (verified locally on 3.12)'
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '-r', str(REPO / 'Module 4 FL/requirements.txt')])
    print('Dependencies installed. Restart the Colab session after the first install, then continue.')
''')
# Mounts Drive (so run artifacts persist across Colab sessions) and loads the
# canonical dataset via fedhealth_ml.data.Dataset, which re-validates its hash.
SETUP = code('''
    from pathlib import Path
    import os, sys, json, subprocess
    REPO = Path('/content/FedHealth-four-class')
    from google.colab import drive
    drive.mount('/content/drive')
    # Keep this identical across all four notebooks. Use a new ID for a new experiment.
    RUN_ID = 'four_class_v1'
    RUN = Path('/content/drive/MyDrive/FYP/four_class') / RUN_ID
    os.chdir(REPO)
    sys.path.insert(0, str(REPO))
    sys.path.insert(0, str(REPO / 'Module 4 FL'))
    from fedhealth_ml.data import Dataset
    from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE
    from fedhealth_ml.runtime import write_json
    dataset = Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE)
    print('Run:', RUN)
    print('Commit:', subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip())
    print('Dataset:', dataset.sha256)
''')
# Standing instructions cell, prepended to every notebook after its title.
INTRO = md('''
Run these notebooks in order, one cell at a time. Inspect each result before continuing.
Use a fresh Colab runtime for the pinned dependencies. CPU is sufficient for this small ANN;
GPU is optional. Use the same RUN_ID in all notebooks. Existing results are never overwritten.
The notebooks import repository code, so training and deployment use one implementation.
No model quality result is prefilled or claimed here.
''')


def write(name, cells):
    """Assemble a minimal valid .ipynb (nbformat 4.5) from the given cells and
    write it next to this script. Cell ids are just their position for stable diffs."""
    notebook = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"}, "colab": {"name": name}}, "nbformat": 4, "nbformat_minor": 5}
    for i, cell in enumerate(cells):
        cell["id"] = f"cell-{i:02d}"
    (HERE / name).write_text(json.dumps(notebook, indent=1) + "\n", encoding="utf-8")


# Notebook 1: inspect the frozen dataset/provenance before touching any model.
write("01_eda.ipynb", [md("# 01 Dataset audit and limitations"), INTRO, INSTALL, SETUP,
    code('''
        import pandas as pd
        print(json.dumps(dataset.audit(), indent=2))
        display(pd.crosstab(dataset.frame.label, dataset.frame.split))
        display(pd.crosstab(dataset.provenance.source, dataset.provenance.label))
        display(dataset.provenance.groupby(['source', 'label_basis']).size().rename('rows'))
    '''), md('''
    Expected: 3,200 rows, 2,240 train, 480 validation, 480 test; 800 of each class.
    1,692 rows contain at least one borrowed value; 891 labels are rule-based.
    Donor imputation was performed upstream before the split. Preserving the supplied split
    does not undo that limitation. Source/style effects, mixed populations and missing
    clinical context limit generalization. The old reported RF numbers are not new results.
    This is a screening prototype; it does not diagnose disease or establish clinical safety.
    ''')])
# Notebook 2: fit the ONE shared preprocessor (imputer+scaler) on train rows,
# save it, and demonstrate explicit lab unit conversion + the research-only rule audit.
write("02_preprocess.ipynb", [md("# 02 Fit and save the shared preprocessor"), INTRO, INSTALL, SETUP,
    code('''
        from fedhealth_ml.training import prepare
        prepared = RUN / 'preprocessing'
        prep = prepare(dataset, prepared)
        print('Fitted rows:', prep.fit_rows, 'Features:', prep.features)
        assert prep.fit_rows == 2240
        print('Saved:', prepared)
    '''), code('''
        from fedhealth_ml.preprocess import normalize_units
        print(normalize_units({'HCT': .38, 'HGB': 124, 'WBC': 9010},
                              units={'HCT': 'fraction', 'HGB': 'g/L', 'WBC': '/mm³'}))
        from fedhealth_ml.rules import validation_audit
        print(validation_audit(dataset.rows('val')))
    '''), md("The example must produce HCT 38%, HGB 12.4 g/dL and WBC 9.01. Rule flags remain disabled in inference. Labs reuse this preprocessor; they never fit their own.")])
# Notebook 3: centralized Module 3 training (ANN + local XGBoost head), with
# the documented hyperparameters and validation-only metrics/plots.
write("03_train_centralized.ipynb", [md("# 03 Train Module 3 ANN and local XGBoost"), INTRO, INSTALL, SETUP,
    md("ANN: 10 → 64 → 32 → 4; dropout 0.30, L2 0.0001, Adam 0.001, batch 32, at most 100 epochs, validation-loss patience 10. XGBoost: at most 300 trees, depth 4, rate 0.05, validation patience 20. Temperature calibration uses validation only."),
    code('''
        from fedhealth_ml.training import train
        CENTRAL = RUN / 'seed42' / 'centralized'
        model_path = train(dataset, CENTRAL, seed=42, epochs=100, patience=10,
                           prepared=RUN / 'preprocessing')
        print('Verified model:', model_path)
    '''), code('''
        import pandas as pd
        report = json.loads((CENTRAL / 'validation_metrics.json').read_text())
        display(pd.DataFrame({name: {k: m[k] for k in ['accuracy', 'macro_f1', 'log_loss', 'ece_15_bins']}
                              for name, m in report['metrics'].items()}).T)
        for name, metrics in report['metrics'].items():
            print(name, 'recall:', metrics['per_class_recall'])
        import matplotlib.pyplot as plt
        history = json.loads((CENTRAL / 'history.json').read_text())
        plt.plot(history['loss'], label='train'); plt.plot(history['val_loss'], label='validation')
        plt.xlabel('Epoch'); plt.ylabel('Loss'); plt.legend(); plt.show()
    '''), md("Pause here and inspect the results. Test has not been evaluated. Share these validation metrics and curves before changing the protocol. Accuracy alone is insufficient; inspect leukemia recall, all four classes and the ANN versus hybrid comparison.")])
# Notebook 4: Module 4 federated fine-tuning of the saved ANN (a smoke test,
# then the fixed multi-seed/multi-partition suite), and the gated final test.
write("04_federated.ipynb", [md("# 04 Module 4 federation and final evaluation"), INTRO, INSTALL, SETUP,
    md("Module 4 fine-tunes the exact saved ANN. Only ANN weights, counts and metrics are exchanged. The Colab orchestrator simulates public-data labs; it is not a demonstration of patient-data privacy. XGBoost is refit centrally as a reference after ANN selection and is never averaged."),
    code('''
        from run_simulation import run
        smoke = run(dataset, RUN / 'seed42/centralized/model', RUN / 'smoke',
                    rounds=2, labs=3, local_epochs=1, seed=42)
        print('Smoke complete:', smoke)
        display(json.loads((RUN / 'smoke/round_history.json').read_text())['aggregation'])
    '''), md("Check that all 3 labs contributed in both rounds and the total is 2,240 rows. Local Adam is reset every round; rate 0.0001, batch 32, one local epoch. Round 0 is eligible and may win. The smoke is excluded from final comparisons."),
    code('''
        from run_experiments import suite
        # Fixed stability protocol: three seeds, four partitions, 20 rounds each.
        # Reuses verified seed 42 central artifacts; trains fresh central models for 52 and 62.
        comparison = suite(dataset, RUN, seeds=(42, 52, 62), rounds=20, epochs=100)
        import pandas as pd
        display(pd.DataFrame([{'seed': r['seed'], 'experiment': r['experiment'],
                              'ann_f1': r['metrics']['ann']['macro_f1'],
                              'hybrid_f1': r['metrics']['hybrid']['macro_f1']}
                             for r in comparison]))
    '''), md("Every round is validated. The selected round has the lowest validation log loss among rounds with macro-F1 no more than 0.05 below round 0 and no extra sick-to-healthy errors. These are experiment selection rules, not clinical safety guarantees. Report every seed and every partition; do not select the best seed."),
    code('''
        # Run only after reviewing validation and freezing all settings.
        RUN_FINAL_TEST = False
        if RUN_FINAL_TEST:
            from fedhealth_ml.final_evaluate import final_evaluate
            final = final_evaluate(dataset, RUN / 'final_evaluation_plan.json', RUN / 'final_test')
            print('Final test saved:', RUN / 'final_test')
        else:
            print('Final test remains locked. Set RUN_FINAL_TEST=True only after protocol freeze.')
    '''), md("Run the following sensitivity check after the final comparison. It trains fresh models and preprocessors excluding each source. Do not tune the main models from its results. Upstream donor imputation still limits source independence."),
    code('''
        RUN_SOURCE_HOLDOUT = False
        if RUN_SOURCE_HOLDOUT:
            from fedhealth_ml.source_holdout import run as source_check
            source_check(dataset, RUN / 'source_holdout', seed=42)
        else:
            print('Source sensitivity not yet run.')
    '''), md("Final deliverables: model bundles and hashes, validation round histories, all-seed comparison, final class/subtype/source recall and ECE, source sensitivity, and negative findings. Module 5 encrypted aggregation and full Module 9 deployment are separate verification tasks.")])
print("Generated four staged Colab notebooks.")
