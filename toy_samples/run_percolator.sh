percolator --default-direction Score \
    --results-psms MD55A3_IFN_1.target.tsv \
    --decoy-results-psms MD55A3_IFN_1.decoy.tsv \
    --weights MD55A3_IFN_1.weights.tsv \
    -P XXX_ \
    -Y -U \
    MD55A3_IFN_1.pXg.pin

java -cp pXg.v2.4.4.jar progistar.tdc.TDC \
    --input MD55A3_IFN_1.pXg \
    --target MD55A3_IFN_1.target.tsv \
    --decoy MD55A3_IFN_1.decoy.tsv \
    --fdr 0.01 \
    --output MD55A3_IFN_1